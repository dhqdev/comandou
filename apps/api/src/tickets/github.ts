/**
 * Cliente mínimo da API do GitHub para a esteira: ler o repositório (privado ou não), criar a
 * branch, gravar um commit com vários arquivos, abrir o PR e acompanhar testes e merge.
 * Funciona com token "fine-grained" (recomendado) ou clássico com escopo "repo".
 */
export class GitHubError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

export interface RepoInfo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  canPush: boolean | null;
}

export interface CompareFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}

function friendly(status: number, body: string, what: string): string {
  let msg = '';
  try {
    msg = (JSON.parse(body) as { message?: string }).message ?? '';
  } catch {
    /* corpo não é JSON */
  }
  if (status === 401) return 'O GitHub recusou o token (vencido ou colado errado)';
  if (status === 403)
    return `O token não tem permissão para ${what}${msg ? ` (${msg})` : ''}. Confira as permissões no tutorial.`;
  if (status === 404)
    return `Não achei ${what}. Em repositório privado, o token precisa ter acesso a ele (Repository access).`;
  if (status === 422) return `GitHub: ${msg || 'pedido recusado'}`;
  return `GitHub respondeu ${status}${msg ? `: ${msg}` : ''}`;
}

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly repo: string,
    private readonly baseUrl = 'https://api.github.com',
  ) {}

  private async req<T>(method: string, path: string, what: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Comandou-Esteira',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new GitHubError(friendly(res.status, text, what), res.status);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private r(path: string) {
    return `/repos/${this.repo}${path}`;
  }

  async repoInfo(): Promise<RepoInfo> {
    const j = await this.req<{
      full_name: string;
      private: boolean;
      default_branch: string;
      permissions?: { push?: boolean };
    }>('GET', this.r(''), `o repositório ${this.repo}`);
    return {
      fullName: j.full_name,
      private: j.private,
      defaultBranch: j.default_branch,
      canPush: j.permissions?.push ?? null,
    };
  }

  async branchSha(branch: string): Promise<string | null> {
    try {
      const j = await this.req<{ object: { sha: string } }>(
        'GET',
        this.r(`/git/ref/heads/${encodeURIComponent(branch)}`),
        `a branch ${branch}`,
      );
      return j.object.sha;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  async createBranch(branch: string, sha: string) {
    await this.req('POST', this.r('/git/refs'), 'criar branch', {
      ref: `refs/heads/${branch}`,
      sha,
    });
  }

  /** Caminhos dos arquivos do repositório (até o limite do GitHub para árvores grandes). */
  async tree(sha: string): Promise<string[]> {
    const j = await this.req<{ tree: { path: string; type: string; size?: number }[] }>(
      'GET',
      this.r(`/git/trees/${sha}?recursive=1`),
      'ler os arquivos do repositório',
    );
    return j.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  }

  /** Conteúdo de um arquivo em texto (null se não existir ou for grande demais). */
  async file(path: string, ref: string, maxBytes = 80_000): Promise<string | null> {
    try {
      const j = await this.req<{ content?: string; encoding?: string; size: number }>(
        'GET',
        this.r(
          `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
        ),
        `o arquivo ${path}`,
      );
      if (j.size > maxBytes || j.encoding !== 'base64' || !j.content) return null;
      return Buffer.from(j.content, 'base64').toString('utf8');
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  /** Um commit com todos os arquivos de uma vez, em cima da ponta da branch. */
  async commitFiles(
    branch: string,
    files: { path: string; content: string }[],
    message: string,
  ): Promise<string> {
    const head = await this.branchSha(branch);
    if (!head) throw new GitHubError(`A branch ${branch} não existe mais`, 404);
    const commit = await this.req<{ tree: { sha: string } }>(
      'GET',
      this.r(`/git/commits/${head}`),
      'ler o último commit',
    );
    const tree = await this.req<{ sha: string }>('POST', this.r('/git/trees'), 'gravar arquivos', {
      base_tree: commit.tree.sha,
      tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
    });
    const created = await this.req<{ sha: string }>(
      'POST',
      this.r('/git/commits'),
      'criar o commit',
      { message, tree: tree.sha, parents: [head] },
    );
    await this.req(
      'PATCH',
      this.r(`/git/refs/heads/${encodeURIComponent(branch)}`),
      'atualizar a branch',
      { sha: created.sha },
    );
    return created.sha;
  }

  async compare(base: string, head: string) {
    const j = await this.req<{
      ahead_by: number;
      files?: CompareFile[];
      html_url: string;
    }>(
      'GET',
      this.r(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`),
      'comparar a branch',
    );
    return { aheadBy: j.ahead_by, files: j.files ?? [], url: j.html_url };
  }

  async findPull(branch: string): Promise<{ number: number; url: string } | null> {
    const owner = this.repo.split('/')[0];
    const j = await this.req<{ number: number; html_url: string }[]>(
      'GET',
      this.r(`/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`),
      'listar PRs',
    );
    return j[0] ? { number: j[0].number, url: j[0].html_url } : null;
  }

  async createPull(p: { title: string; body: string; head: string; base: string }) {
    const j = await this.req<{ number: number; html_url: string }>(
      'POST',
      this.r('/pulls'),
      'abrir o PR',
      { ...p, draft: true, maintainer_can_modify: true },
    );
    return { number: j.number, url: j.html_url };
  }

  async pull(n: number) {
    const j = await this.req<{
      state: string;
      merged: boolean;
      merged_at: string | null;
      head: { sha: string };
      html_url: string;
    }>('GET', this.r(`/pulls/${n}`), `o PR #${n}`);
    return {
      state: j.state,
      merged: j.merged,
      mergedAt: j.merged_at,
      headSha: j.head.sha,
      url: j.html_url,
    };
  }

  /** Execuções do GitHub Actions para um commit (permissão Actions: leitura). */
  async runs(sha: string): Promise<WorkflowRun[]> {
    const j = await this.req<{
      workflow_runs: {
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string;
      }[];
    }>('GET', this.r(`/actions/runs?head_sha=${sha}&per_page=20`), 'ler o GitHub Actions');
    return j.workflow_runs.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      url: r.html_url,
    }));
  }
}
