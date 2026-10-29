import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ROLE_LABELS, roleHas, type Role } from '@comandou/shared';
import { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

export type ConversationKind = 'direct' | 'group' | 'channel';

/** Reações aceitas (as mesmas do seletor da tela). */
export const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏', '🔥', '✅'] as const;

/** Visto por último há menos disso = "online". */
const ONLINE_MS = 5 * 60_000;
const PAGE = 50;

export interface Person {
  id: string;
  name: string;
  role: Role;
  roleLabel: string;
  online: boolean;
  lastSeenAt: string | null;
}

interface MessageRow {
  id: string;
  conversationId: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  imageId: string | null;
  replyTo: string | null;
  replyBody: string | null;
  replyAuthor: string | null;
  reactions: Record<string, string[]>;
  system: boolean;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

const MSG_COLS = `m.id, m.conversation_id AS "conversationId", m.author_id AS "authorId",
  au.name AS "authorName",
  CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
  CASE WHEN m.deleted_at IS NULL THEN m.image_id END AS "imageId",
  m.reply_to AS "replyTo",
  CASE WHEN r.deleted_at IS NULL THEN left(r.body, 140) END AS "replyBody", ru.name AS "replyAuthor",
  m.reactions, m.system, m.created_at AS "createdAt", m.edited_at AS "editedAt",
  m.deleted_at AS "deletedAt"`;
const MSG_FROM = `chat_messages m
  LEFT JOIN users au ON au.id = m.author_id
  LEFT JOIN chat_messages r ON r.id = m.reply_to
  LEFT JOIN users ru ON ru.id = r.author_id`;

const directKey = (a: string, b: string) => [a, b].sort().join(':');

/**
 * Chat interno da equipe: conversas diretas, grupos e canais, o Mural (recados para todos) e os
 * Avisos de cada pessoa. Tudo no banco do restaurante, com RLS. Quem não participa de uma
 * conversa não lê nem escreve nela (conferido em cada chamada). O tempo real só leva ids.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------- pessoas ----------

  async people(ctx: Ctx): Promise<Person[]> {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await q<{ id: string; name: string; role: Role; lastSeenAt: Date | null }>(
        tx,
        `SELECT u.id, u.name, m.role,
                (SELECT max(s.last_seen_at) FROM sessions s
                  WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS "lastSeenAt"
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.status = 'active' AND u.disabled_at IS NULL
          ORDER BY u.name`,
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        roleLabel: ROLE_LABELS[r.role] ?? r.role,
        online: !!r.lastSeenAt && Date.now() - r.lastSeenAt.getTime() < ONLINE_MS,
        lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      }));
    });
  }

  private async activeIds(tx: Tx, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await q<{ id: string }>(
      tx,
      `SELECT m.user_id AS id FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.status = 'active' AND u.disabled_at IS NULL AND m.user_id = ANY($1::uuid[])`,
      [ids],
    );
    return rows.map((r) => r.id);
  }

  // ---------- conversas ----------

  private async memberOf(tx: Tx, conversationId: string, userId: string) {
    const m = await one<{ role: 'admin' | 'member'; kind: ConversationKind }>(
      tx,
      `SELECT cm.role, c.kind FROM chat_members cm
         JOIN chat_conversations c ON c.id = cm.conversation_id
        WHERE cm.conversation_id = $1 AND cm.user_id = $2`,
      [conversationId, userId],
    );
    if (!m) throw new NotFoundException('Conversa não encontrada');
    return m;
  }

  private async memberIds(tx: Tx, conversationId: string): Promise<string[]> {
    const rows = await q<{ id: string }>(
      tx,
      `SELECT user_id AS id FROM chat_members WHERE conversation_id = $1`,
      [conversationId],
    );
    return rows.map((r) => r.id);
  }

  /** Conversas da pessoa, com a última mensagem e quantas não leu. Fixadas primeiro. */
  async conversations(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) => this.listFor(tx, ctx.userId!));
  }

  private async listFor(tx: Tx, me: string, onlyId?: string) {
    const rows = await q<{
      id: string;
      kind: ConversationKind;
      name: string | null;
      description: string | null;
      lastMessageAt: Date | null;
      createdAt: Date;
      muted: boolean;
      pinned: boolean;
      myRole: 'admin' | 'member';
      memberCount: number;
      unread: number;
      peerId: string | null;
      peerName: string | null;
      peerRole: Role | null;
      peerSeen: Date | null;
      lastBody: string | null;
      lastImage: boolean | null;
      lastAuthorId: string | null;
      lastAuthor: string | null;
      lastSystem: boolean | null;
      lastDeleted: boolean | null;
    }>(
      tx,
      `SELECT c.id, c.kind, c.name, c.description, c.last_message_at AS "lastMessageAt",
              c.created_at AS "createdAt", me.muted, me.pinned, me.role AS "myRole",
              (SELECT count(*)::int FROM chat_members x WHERE x.conversation_id = c.id) AS "memberCount",
              (SELECT count(*)::int FROM chat_messages x
                WHERE x.conversation_id = c.id AND x.created_at > me.last_read_at
                  AND x.author_id IS DISTINCT FROM $1 AND x.deleted_at IS NULL AND NOT x.system) AS unread,
              peer.user_id AS "peerId", pu.name AS "peerName", pm.role AS "peerRole",
              (SELECT max(s.last_seen_at) FROM sessions s
                WHERE s.user_id = peer.user_id AND s.revoked_at IS NULL) AS "peerSeen",
              lm.body AS "lastBody", lm.image_id IS NOT NULL AS "lastImage",
              lm.author_id AS "lastAuthorId", lu.name AS "lastAuthor", lm.system AS "lastSystem",
              lm.deleted_at IS NOT NULL AS "lastDeleted"
         FROM chat_members me
         JOIN chat_conversations c ON c.id = me.conversation_id
         LEFT JOIN chat_members peer
           ON c.kind = 'direct' AND peer.conversation_id = c.id AND peer.user_id <> $1
         LEFT JOIN users pu ON pu.id = peer.user_id
         LEFT JOIN memberships pm ON pm.user_id = peer.user_id
         LEFT JOIN LATERAL (
           SELECT * FROM chat_messages z WHERE z.conversation_id = c.id
            ORDER BY z.created_at DESC LIMIT 1) lm ON true
         LEFT JOIN users lu ON lu.id = lm.author_id
        WHERE me.user_id = $1 AND ($2::uuid IS NULL OR c.id = $2)
        ORDER BY me.pinned DESC, coalesce(c.last_message_at, c.created_at) DESC`,
      [me, onlyId ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.kind === 'direct' ? (r.peerName ?? 'Conversa') : r.name!,
      description: r.description,
      muted: r.muted,
      pinned: r.pinned,
      myRole: r.myRole,
      memberCount: r.memberCount,
      unread: r.unread,
      updatedAt: (r.lastMessageAt ?? r.createdAt).toISOString(),
      peer: r.peerId
        ? {
            id: r.peerId,
            name: r.peerName!,
            roleLabel: r.peerRole ? (ROLE_LABELS[r.peerRole] ?? r.peerRole) : '',
            online: !!r.peerSeen && Date.now() - r.peerSeen.getTime() < ONLINE_MS,
          }
        : null,
      last:
        r.lastBody === null && !r.lastImage
          ? null
          : {
              body: r.lastDeleted ? 'Mensagem apagada' : r.lastBody || (r.lastImage ? '📷 Foto' : ''),
              authorId: r.lastAuthorId,
              authorName: r.lastAuthor,
              system: !!r.lastSystem,
            },
    }));
  }

  private async one(tx: Tx, me: string, id: string) {
    const [c] = await this.listFor(tx, me, id);
    if (!c) throw new NotFoundException('Conversa não encontrada');
    return c;
  }

  /** Abre (ou cria) a conversa direta com outra pessoa da equipe. */
  async direct(ctx: Ctx, otherId: string) {
    const me = ctx.userId!;
    if (otherId === me) throw new UnprocessableEntityException('Escolha outra pessoa');
    const created = await this.db.withTenant(ctx, async (tx) => {
      if (!(await this.activeIds(tx, [otherId])).length)
        throw new NotFoundException('Pessoa não encontrada na equipe');
      const key = directKey(me, otherId);
      const existing = await one<{ id: string }>(
        tx,
        `SELECT id FROM chat_conversations WHERE direct_key = $1`,
        [key],
      );
      if (existing) return { conv: await this.one(tx, me, existing.id), isNew: false };
      const c = await one<{ id: string }>(
        tx,
        `INSERT INTO chat_conversations (tenant_id, kind, direct_key, created_by)
         VALUES ($1, 'direct', $2, $3)
         ON CONFLICT (tenant_id, direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
         RETURNING id`,
        [ctx.tenantId, key, me],
      );
      await q(
        tx,
        `INSERT INTO chat_members (tenant_id, conversation_id, user_id, role)
         SELECT $1, $2, u, 'admin' FROM unnest($3::uuid[]) u ON CONFLICT DO NOTHING`,
        [ctx.tenantId, c!.id, [me, otherId]],
      );
      return { conv: await this.one(tx, me, c!.id), isNew: true };
    });
    if (created.isNew)
      this.realtime.publishToUsers(ctx.tenantId, [me, otherId], {
        type: 'chat.changed',
        conversationId: created.conv.id,
      });
    return created.conv;
  }

  /** Grupo (só quem foi chamado) ou canal (aberto: qualquer um da equipe entra). */
  async create(
    ctx: Ctx,
    input: { kind: 'group' | 'channel'; name: string; description?: string | null; memberIds: string[] },
  ) {
    const me = ctx.userId!;
    const res = await this.db.withTenant(ctx, async (tx) => {
      const ids = await this.activeIds(
        tx,
        [...new Set(input.memberIds)].filter((i) => i !== me),
      );
      if (input.kind === 'group' && ids.length === 0)
        throw new UnprocessableEntityException('Escolha ao menos uma pessoa para o grupo');
      const c = await one<{ id: string }>(
        tx,
        `INSERT INTO chat_conversations (tenant_id, kind, name, description, created_by, last_message_at)
         VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
        [ctx.tenantId, input.kind, input.name, input.description ?? null, me],
      );
      await q(
        tx,
        `INSERT INTO chat_members (tenant_id, conversation_id, user_id, role)
         VALUES ($1, $2, $3, 'admin')`,
        [ctx.tenantId, c!.id, me],
      );
      if (ids.length)
        await q(
          tx,
          `INSERT INTO chat_members (tenant_id, conversation_id, user_id, last_read_at)
           SELECT $1, $2, u, 'epoch' FROM unnest($3::uuid[]) u ON CONFLICT DO NOTHING`,
          [ctx.tenantId, c!.id, ids],
        );
      await this.systemMessage(
        tx,
        ctx,
        c!.id,
        input.kind === 'group'
          ? `${ctx.user.name} criou o grupo "${input.name}"`
          : `${ctx.user.name} criou o canal "${input.name}"`,
      );
      for (const id of ids)
        await this.notice(tx, ctx, id, {
          kind: 'group',
          title: `${ctx.user.name} adicionou você em "${input.name}"`,
          conversationId: c!.id,
        });
      return { conv: await this.one(tx, me, c!.id), ids };
    });
    this.realtime.publishToUsers(ctx.tenantId, [me, ...res.ids], {
      type: 'chat.changed',
      conversationId: res.conv.id,
    });
    if (res.ids.length) this.realtime.publishToUsers(ctx.tenantId, res.ids, { type: 'chat.notice' });
    if (input.kind === 'channel')
      this.realtime.publish(ctx.tenantId, { type: 'chat.changed', conversationId: res.conv.id });
    return res.conv;
  }

  /** Canais abertos em que a pessoa ainda não entrou. */
  async openChannels(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) =>
      q<{ id: string; name: string; description: string | null; memberCount: number }>(
        tx,
        `SELECT c.id, c.name, c.description,
                (SELECT count(*)::int FROM chat_members x WHERE x.conversation_id = c.id) AS "memberCount"
           FROM chat_conversations c
          WHERE c.kind = 'channel'
            AND NOT EXISTS (SELECT 1 FROM chat_members x WHERE x.conversation_id = c.id AND x.user_id = $1)
          ORDER BY c.name`,
        [ctx.userId],
      ),
    );
  }

  async join(ctx: Ctx, id: string) {
    const me = ctx.userId!;
    const conv = await this.db.withTenant(ctx, async (tx) => {
      const c = await one<{ kind: ConversationKind }>(
        tx,
        `SELECT kind FROM chat_conversations WHERE id = $1`,
        [id],
      );
      if (!c || c.kind !== 'channel') throw new NotFoundException('Canal não encontrado');
      const ins = await q(
        tx,
        `INSERT INTO chat_members (tenant_id, conversation_id, user_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING user_id`,
        [ctx.tenantId, id, me],
      );
      if (ins.length) await this.systemMessage(tx, ctx, id, `${ctx.user.name} entrou no canal`);
      return this.one(tx, me, id);
    });
    await this.broadcastChange(ctx, id);
    return conv;
  }

  async leave(ctx: Ctx, id: string) {
    const me = ctx.userId!;
    await this.db.withTenant(ctx, async (tx) => {
      const m = await this.memberOf(tx, id, me);
      if (m.kind === 'direct')
        throw new UnprocessableEntityException('Não dá para sair de uma conversa direta');
      await q(tx, `DELETE FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [id, me]);
      const rest = await q<{ user_id: string; role: string }>(
        tx,
        `SELECT user_id, role FROM chat_members WHERE conversation_id = $1 ORDER BY joined_at`,
        [id],
      );
      // Quem sai por último leva junto o grupo; o mais antigo vira administrador se faltar um.
      if (!rest.length) {
        if (m.kind === 'group') await q(tx, `DELETE FROM chat_conversations WHERE id = $1`, [id]);
        return;
      }
      if (!rest.some((r) => r.role === 'admin'))
        await q(
          tx,
          `UPDATE chat_members SET role = 'admin' WHERE conversation_id = $1 AND user_id = $2`,
          [id, rest[0]!.user_id],
        );
      await this.systemMessage(tx, ctx, id, `${ctx.user.name} saiu`);
    });
    this.realtime.publishToUsers(ctx.tenantId, [me], { type: 'chat.changed', conversationId: id });
    await this.broadcastChange(ctx, id);
    return { ok: true };
  }

  async detail(ctx: Ctx, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.memberOf(tx, id, ctx.userId!);
      const conv = await this.one(tx, ctx.userId!, id);
      const members = await q<{
        id: string;
        name: string;
        role: Role | null;
        chatRole: 'admin' | 'member';
        lastReadAt: Date;
        seen: Date | null;
      }>(
        tx,
        `SELECT cm.user_id AS id, u.name, ms.role, cm.role AS "chatRole",
                cm.last_read_at AS "lastReadAt",
                (SELECT max(s.last_seen_at) FROM sessions s
                  WHERE s.user_id = cm.user_id AND s.revoked_at IS NULL) AS seen
           FROM chat_members cm
           JOIN users u ON u.id = cm.user_id
           LEFT JOIN memberships ms ON ms.user_id = cm.user_id
          WHERE cm.conversation_id = $1
          ORDER BY cm.role, u.name`,
        [id],
      );
      return {
        ...conv,
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          roleLabel: m.role ? (ROLE_LABELS[m.role] ?? m.role) : '',
          admin: m.chatRole === 'admin',
          online: !!m.seen && Date.now() - m.seen.getTime() < ONLINE_MS,
          lastReadAt: m.lastReadAt.getTime() > 0 ? m.lastReadAt.toISOString() : null,
        })),
      };
    });
  }

  async update(
    ctx: Ctx,
    id: string,
    patch: { name?: string; description?: string | null; muted?: boolean; pinned?: boolean },
  ) {
    const me = ctx.userId!;
    const changedInfo = patch.name !== undefined || patch.description !== undefined;
    const conv = await this.db.withTenant(ctx, async (tx) => {
      const m = await this.memberOf(tx, id, me);
      if (patch.muted !== undefined || patch.pinned !== undefined)
        await q(
          tx,
          `UPDATE chat_members SET muted = coalesce($3, muted), pinned = coalesce($4, pinned)
            WHERE conversation_id = $1 AND user_id = $2`,
          [id, me, patch.muted ?? null, patch.pinned ?? null],
        );
      if (changedInfo) {
        if (m.kind === 'direct') throw new UnprocessableEntityException('Conversa direta não tem nome');
        if (m.role !== 'admin') throw new ForbiddenException('Só o administrador muda o nome');
        await q(
          tx,
          `UPDATE chat_conversations SET name = coalesce($2, name),
                  description = CASE WHEN $3 THEN $4 ELSE description END
            WHERE id = $1`,
          [id, patch.name ?? null, patch.description !== undefined, patch.description ?? null],
        );
      }
      return this.one(tx, me, id);
    });
    if (changedInfo) await this.broadcastChange(ctx, id);
    return conv;
  }

  async addMembers(ctx: Ctx, id: string, userIds: string[]) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const m = await this.memberOf(tx, id, ctx.userId!);
      if (m.kind === 'direct') throw new UnprocessableEntityException('Crie um grupo para isso');
      if (m.kind === 'group' && m.role !== 'admin')
        throw new ForbiddenException('Só o administrador do grupo adiciona pessoas');
      const ids = await this.activeIds(tx, userIds);
      const added = await q<{ user_id: string; name: string }>(
        tx,
        `WITH ins AS (
           INSERT INTO chat_members (tenant_id, conversation_id, user_id, last_read_at)
           SELECT $1, $2, u, 'epoch' FROM unnest($3::uuid[]) u ON CONFLICT DO NOTHING
           RETURNING user_id)
         SELECT ins.user_id, u.name FROM ins JOIN users u ON u.id = ins.user_id`,
        [ctx.tenantId, id, ids],
      );
      const conv = await this.one(tx, ctx.userId!, id);
      if (added.length) {
        await this.systemMessage(
          tx,
          ctx,
          id,
          `${ctx.user.name} adicionou ${added.map((a) => a.name).join(', ')}`,
        );
        for (const a of added)
          await this.notice(tx, ctx, a.user_id, {
            kind: 'group',
            title: `${ctx.user.name} adicionou você em "${conv.name}"`,
            conversationId: id,
          });
      }
      return { conv, added: added.map((a) => a.user_id) };
    });
    if (res.added.length)
      this.realtime.publishToUsers(ctx.tenantId, res.added, { type: 'chat.notice' });
    await this.broadcastChange(ctx, id);
    return res.conv;
  }

  async removeMember(ctx: Ctx, id: string, userId: string) {
    if (userId === ctx.userId) return this.leave(ctx, id);
    await this.db.withTenant(ctx, async (tx) => {
      const m = await this.memberOf(tx, id, ctx.userId!);
      if (m.kind === 'direct' || m.role !== 'admin')
        throw new ForbiddenException('Só o administrador remove pessoas');
      const gone = await one<{ name: string }>(
        tx,
        `WITH d AS (DELETE FROM chat_members WHERE conversation_id = $1 AND user_id = $2 RETURNING user_id)
         SELECT u.name FROM d JOIN users u ON u.id = d.user_id`,
        [id, userId],
      );
      if (gone) await this.systemMessage(tx, ctx, id, `${ctx.user.name} removeu ${gone.name}`);
    });
    this.realtime.publishToUsers(ctx.tenantId, [userId], { type: 'chat.changed', conversationId: id });
    await this.broadcastChange(ctx, id);
    return { ok: true };
  }

  private async broadcastChange(ctx: Ctx, id: string) {
    const ids = await this.db.withTenant(ctx, (tx) => this.memberIds(tx, id));
    this.realtime.publishToUsers(ctx.tenantId, ids, { type: 'chat.changed', conversationId: id });
  }

  // ---------- mensagens ----------

  async messages(ctx: Ctx, id: string, before?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.memberOf(tx, id, ctx.userId!);
      const rows = await q<MessageRow>(
        tx,
        `SELECT ${MSG_COLS} FROM ${MSG_FROM}
          WHERE m.conversation_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
          ORDER BY m.created_at DESC LIMIT ${PAGE + 1}`,
        [id, before ?? null],
      );
      const more = rows.length > PAGE;
      return { messages: rows.slice(0, PAGE).reverse().map(view), more };
    });
  }

  async send(
    ctx: Ctx,
    id: string,
    input: { body: string; imageId?: string | null; replyTo?: string | null; mentions?: string[] },
  ) {
    const body = input.body.trim();
    if (!body && !input.imageId) throw new UnprocessableEntityException('Mensagem vazia');
    const res = await this.db.withTenant(ctx, async (tx) => {
      await this.memberOf(tx, id, ctx.userId!);
      if (input.imageId) {
        const img = await one(tx, `SELECT 1 FROM media WHERE id = $1`, [input.imageId]);
        if (!img) throw new UnprocessableEntityException('Foto não encontrada');
      }
      if (input.replyTo) {
        const r = await one(
          tx,
          `SELECT 1 FROM chat_messages WHERE id = $1 AND conversation_id = $2`,
          [input.replyTo, id],
        );
        if (!r) throw new UnprocessableEntityException('Mensagem respondida não encontrada');
      }
      const m = await one<{ id: string }>(
        tx,
        `INSERT INTO chat_messages (tenant_id, conversation_id, author_id, body, image_id, reply_to)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [ctx.tenantId, id, ctx.userId, body, input.imageId ?? null, input.replyTo ?? null],
      );
      await q(tx, `UPDATE chat_conversations SET last_message_at = now() WHERE id = $1`, [id]);
      await q(
        tx,
        `UPDATE chat_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`,
        [id, ctx.userId],
      );
      const members = await this.memberIds(tx, id);
      // Menções: só quem está na conversa recebe o aviso.
      const mentioned = [...new Set(input.mentions ?? [])].filter(
        (u) => u !== ctx.userId && members.includes(u),
      );
      if (mentioned.length) {
        const conv = await this.one(tx, ctx.userId!, id);
        for (const u of mentioned)
          await this.notice(tx, ctx, u, {
            kind: 'mention',
            title:
              conv.kind === 'direct'
                ? `${ctx.user.name} mencionou você`
                : `${ctx.user.name} mencionou você em "${conv.name}"`,
            body: body.slice(0, 300) || '📷 Foto',
            conversationId: id,
          });
      }
      const row = await one<MessageRow>(tx, `SELECT ${MSG_COLS} FROM ${MSG_FROM} WHERE m.id = $1`, [
        m!.id,
      ]);
      return { message: view(row!), members, mentioned };
    });
    this.realtime.publishToUsers(ctx.tenantId, res.members, {
      type: 'chat.message',
      conversationId: id,
      messageId: res.message.id,
      authorId: ctx.userId,
    });
    if (res.mentioned.length)
      this.realtime.publishToUsers(ctx.tenantId, res.mentioned, { type: 'chat.notice' });
    return res.message;
  }

  private async ownMessage(tx: Tx, ctx: Ctx, messageId: string) {
    const m = await one<{ conversationId: string; authorId: string | null; system: boolean }>(
      tx,
      `SELECT conversation_id AS "conversationId", author_id AS "authorId", system
         FROM chat_messages WHERE id = $1 AND deleted_at IS NULL`,
      [messageId],
    );
    if (!m) throw new NotFoundException('Mensagem não encontrada');
    const member = await this.memberOf(tx, m.conversationId, ctx.userId!);
    return { ...m, member };
  }

  async edit(ctx: Ctx, messageId: string, body: string) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const m = await this.ownMessage(tx, ctx, messageId);
      if (m.authorId !== ctx.userId) throw new ForbiddenException('Só quem escreveu pode editar');
      await q(tx, `UPDATE chat_messages SET body = $2, edited_at = now() WHERE id = $1`, [
        messageId,
        body.trim(),
      ]);
      const row = await one<MessageRow>(tx, `SELECT ${MSG_COLS} FROM ${MSG_FROM} WHERE m.id = $1`, [
        messageId,
      ]);
      return { message: view(row!), members: await this.memberIds(tx, m.conversationId) };
    });
    this.realtime.publishToUsers(ctx.tenantId, res.members, {
      type: 'chat.message',
      conversationId: res.message.conversationId,
      messageId,
      authorId: ctx.userId,
    });
    return res.message;
  }

  async remove(ctx: Ctx, messageId: string) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const m = await this.ownMessage(tx, ctx, messageId);
      if (m.authorId !== ctx.userId && m.member.role !== 'admin')
        throw new ForbiddenException('Só quem escreveu (ou o administrador) pode apagar');
      await q(tx, `UPDATE chat_messages SET deleted_at = now() WHERE id = $1`, [messageId]);
      return { conversationId: m.conversationId, members: await this.memberIds(tx, m.conversationId) };
    });
    this.realtime.publishToUsers(ctx.tenantId, res.members, {
      type: 'chat.message',
      conversationId: res.conversationId,
      messageId,
      authorId: ctx.userId,
    });
    return { ok: true };
  }

  async react(ctx: Ctx, messageId: string, emoji: string) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const m = await this.ownMessage(tx, ctx, messageId);
      await toggleReaction(tx, 'chat_messages', messageId, emoji, ctx.userId!);
      const row = await one<MessageRow>(tx, `SELECT ${MSG_COLS} FROM ${MSG_FROM} WHERE m.id = $1`, [
        messageId,
      ]);
      return { message: view(row!), members: await this.memberIds(tx, m.conversationId) };
    });
    this.realtime.publishToUsers(ctx.tenantId, res.members, {
      type: 'chat.message',
      conversationId: res.message.conversationId,
      messageId,
      authorId: null,
    });
    return res.message;
  }

  async read(ctx: Ctx, id: string) {
    const members = await this.db.withTenant(ctx, async (tx) => {
      await this.memberOf(tx, id, ctx.userId!);
      await q(
        tx,
        `UPDATE chat_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`,
        [id, ctx.userId],
      );
      return this.memberIds(tx, id);
    });
    this.realtime.publishToUsers(ctx.tenantId, members, {
      type: 'chat.read',
      conversationId: id,
      userId: ctx.userId!,
    });
    return { ok: true };
  }

  async typing(ctx: Ctx, id: string) {
    const members = await this.db.withTenant(ctx, async (tx) => {
      await this.memberOf(tx, id, ctx.userId!);
      return this.memberIds(tx, id);
    });
    this.realtime.publishToUsers(
      ctx.tenantId,
      members.filter((m) => m !== ctx.userId),
      { type: 'chat.typing', conversationId: id, userId: ctx.userId!, name: ctx.user.name },
    );
    return { ok: true };
  }

  /** Busca nas conversas da pessoa (texto das mensagens). */
  async search(ctx: Ctx, term: string) {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await q<MessageRow & { conversationName: string | null; kind: ConversationKind }>(
        tx,
        `SELECT ${MSG_COLS}, c.name AS "conversationName", c.kind
           FROM ${MSG_FROM}
           JOIN chat_conversations c ON c.id = m.conversation_id
           JOIN chat_members me ON me.conversation_id = c.id AND me.user_id = $1
          WHERE m.deleted_at IS NULL AND NOT m.system AND m.body ILIKE $2
          ORDER BY m.created_at DESC LIMIT 30`,
        [ctx.userId, like],
      );
      return rows.map((r) => ({ ...view(r), conversationName: r.conversationName, kind: r.kind }));
    });
  }

  /** Para o botão do chat: mensagens e avisos não lidos. */
  async summary(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const r = await one<{ unread: number; notices: number }>(
        tx,
        `SELECT
           (SELECT count(*)::int FROM chat_messages x
              JOIN chat_members me ON me.conversation_id = x.conversation_id AND me.user_id = $1
             WHERE x.created_at > me.last_read_at AND NOT me.muted
               AND x.author_id IS DISTINCT FROM $1 AND x.deleted_at IS NULL AND NOT x.system) AS unread,
           (SELECT count(*)::int FROM chat_notices WHERE user_id = $1 AND read_at IS NULL) AS notices`,
        [ctx.userId],
      );
      return r!;
    });
  }

  private async systemMessage(tx: Tx, ctx: Ctx, conversationId: string, body: string) {
    await q(
      tx,
      `INSERT INTO chat_messages (tenant_id, conversation_id, author_id, body, system)
       VALUES ($1, $2, $3, $4, true)`,
      [ctx.tenantId, conversationId, ctx.userId, body.slice(0, 4000)],
    );
    await q(tx, `UPDATE chat_conversations SET last_message_at = now() WHERE id = $1`, [
      conversationId,
    ]);
  }

  // ---------- mural ----------

  async posts(ctx: Ctx, before?: string) {
    return this.db.withTenant(ctx, (tx) =>
      q<{
        id: string;
        authorId: string | null;
        authorName: string | null;
        authorRole: Role | null;
        body: string;
        imageId: string | null;
        pinned: boolean;
        reactions: Record<string, string[]>;
        createdAt: Date;
      }>(
        tx,
        `SELECT p.id, p.author_id AS "authorId", u.name AS "authorName", ms.role AS "authorRole",
                p.body, p.image_id AS "imageId", p.pinned, p.reactions, p.created_at AS "createdAt"
           FROM chat_posts p
           LEFT JOIN users u ON u.id = p.author_id
           LEFT JOIN memberships ms ON ms.user_id = p.author_id
          WHERE p.deleted_at IS NULL AND ($1::timestamptz IS NULL OR p.created_at < $1)
          ORDER BY ${before ? '' : 'p.pinned DESC,'} p.created_at DESC LIMIT 30`,
        [before ?? null],
      ).then((rows) =>
        rows.map((r) => ({
          ...r,
          authorRole: r.authorRole ? (ROLE_LABELS[r.authorRole] ?? r.authorRole) : null,
        })),
      ),
    );
  }

  async post(ctx: Ctx, input: { body: string; imageId?: string | null }) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      if (input.imageId) {
        const img = await one(tx, `SELECT 1 FROM media WHERE id = $1`, [input.imageId]);
        if (!img) throw new UnprocessableEntityException('Foto não encontrada');
      }
      const p = await one<{ id: string }>(
        tx,
        `INSERT INTO chat_posts (tenant_id, author_id, body, image_id) VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [ctx.tenantId, ctx.userId, input.body.trim(), input.imageId ?? null],
      );
      const others = await q<{ id: string }>(
        tx,
        `SELECT m.user_id AS id FROM memberships m WHERE m.status = 'active' AND m.user_id <> $1`,
        [ctx.userId],
      );
      for (const o of others)
        await this.notice(tx, ctx, o.id, {
          kind: 'post',
          title: `${ctx.user.name} publicou no mural`,
          body: input.body.trim().slice(0, 300),
          postId: p!.id,
        });
      return { id: p!.id, others: others.map((o) => o.id) };
    });
    this.realtime.publish(ctx.tenantId, { type: 'chat.mural' });
    this.realtime.publishToUsers(ctx.tenantId, res.others, { type: 'chat.notice' });
    return { id: res.id };
  }

  async reactPost(ctx: Ctx, id: string, emoji: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const p = await one(tx, `SELECT 1 FROM chat_posts WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (!p) throw new NotFoundException('Recado não encontrado');
      await toggleReaction(tx, 'chat_posts', id, emoji, ctx.userId!);
    });
    this.realtime.publish(ctx.tenantId, { type: 'chat.mural' });
    return { ok: true };
  }

  async pinPost(ctx: Ctx, id: string, pinned: boolean) {
    if (!roleHas(ctx.user.role, 'settings:manage'))
      throw new ForbiddenException('Só o gestor fixa recados');
    await this.db.withTenant(ctx, async (tx) => {
      const r = await q(
        tx,
        `UPDATE chat_posts SET pinned = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id, pinned],
      );
      if (!r.length) throw new NotFoundException('Recado não encontrado');
    });
    this.realtime.publish(ctx.tenantId, { type: 'chat.mural' });
    return { ok: true };
  }

  async removePost(ctx: Ctx, id: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const p = await one<{ authorId: string | null }>(
        tx,
        `SELECT author_id AS "authorId" FROM chat_posts WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!p) throw new NotFoundException('Recado não encontrado');
      if (p.authorId !== ctx.userId && !roleHas(ctx.user.role, 'settings:manage'))
        throw new ForbiddenException('Só quem escreveu (ou o gestor) pode apagar');
      await q(tx, `UPDATE chat_posts SET deleted_at = now() WHERE id = $1`, [id]);
    });
    this.realtime.publish(ctx.tenantId, { type: 'chat.mural' });
    return { ok: true };
  }

  // ---------- avisos ----------

  async notices(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `SELECT n.id, n.kind, n.title, n.body, n.conversation_id AS "conversationId",
                n.post_id AS "postId", n.created_at AS "createdAt", n.read_at AS "readAt",
                u.name AS "actorName"
           FROM chat_notices n LEFT JOIN users u ON u.id = n.actor_id
          WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 60`,
        [ctx.userId],
      ),
    );
  }

  async readNotices(ctx: Ctx, ids?: string[]) {
    await this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `UPDATE chat_notices SET read_at = now()
          WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
        [ctx.userId, ids ?? null],
      ),
    );
    this.realtime.publishToUsers(ctx.tenantId, [ctx.userId!], { type: 'chat.notice' });
    return { ok: true };
  }

  async notice(
    tx: Tx,
    ctx: { tenantId: string; userId: string | null },
    userId: string,
    n: {
      kind: 'mention' | 'group' | 'post' | 'ai' | 'system';
      title: string;
      body?: string | null;
      conversationId?: string;
      postId?: string;
    },
  ) {
    await q(
      tx,
      `INSERT INTO chat_notices (tenant_id, user_id, kind, title, body, conversation_id, post_id, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        ctx.tenantId,
        userId,
        n.kind,
        n.title.slice(0, 120),
        n.body ? n.body.slice(0, 300) : null,
        n.conversationId ?? null,
        n.postId ?? null,
        ctx.userId,
      ],
    );
  }
}

function view(r: MessageRow) {
  return {
    id: r.id,
    conversationId: r.conversationId,
    authorId: r.authorId,
    authorName: r.authorName,
    body: r.body,
    imageId: r.imageId,
    reply: r.replyTo ? { id: r.replyTo, body: r.replyBody, authorName: r.replyAuthor } : null,
    reactions: r.reactions ?? {},
    system: r.system,
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt?.toISOString() ?? null,
    deleted: !!r.deletedAt,
  };
}

/** Liga/desliga a reação da pessoa (uma de cada tipo por pessoa). */
async function toggleReaction(
  tx: Tx,
  table: 'chat_messages' | 'chat_posts',
  id: string,
  emoji: string,
  userId: string,
) {
  if (!(REACTIONS as readonly string[]).includes(emoji))
    throw new UnprocessableEntityException('Reação inválida');
  await q(
    tx,
    `UPDATE ${table} SET reactions = (
       SELECT CASE WHEN cardinality(arr) = 0 THEN reactions - $2 ELSE jsonb_set(reactions, ARRAY[$2], to_jsonb(arr)) END
         FROM (SELECT CASE WHEN coalesce(reactions -> $2, '[]'::jsonb) ? $3
                           THEN ARRAY(SELECT x FROM jsonb_array_elements_text(reactions -> $2) x WHERE x <> $3)
                           ELSE ARRAY(SELECT x FROM jsonb_array_elements_text(coalesce(reactions -> $2, '[]'::jsonb)) x) || $3::text
                      END AS arr) s)
     WHERE id = $1`,
    [id, emoji, userId],
  );
}
