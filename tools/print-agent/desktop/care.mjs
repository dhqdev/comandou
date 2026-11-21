// "Cuidar do computador" (só Windows): checagem que não muda nada, limpeza do que o sistema e os
// programas recriam sozinhos e reparo com as ferramentas do próprio Windows.
//
// Regras que não podem mudar:
// - Nunca toca em Documentos, Downloads, Área de Trabalho, Lixeira, senhas, histórico ou favoritos.
// - Só apaga dentro das pastas fixas abaixo, nunca segue atalho de pasta (junction/symlink) e só
//   apaga arquivo com mais de 24 horas nas pastas temporárias.
// - O caminho vem de LOCALAPPDATA/SystemRoot, nunca de TEMP (que pode apontar para qualquer lugar).
// - O script com permissão de administrador vai inline (-EncodedCommand), sem arquivo no disco que
//   outro programa pudesse trocar, e só com ações desta lista.
import { powershell } from '../printers.mjs';

/** O que a pessoa pode escolher. `admin`: o Windows pede permissão. */
export const CARE_ACTIONS = [
  {
    id: 'temp',
    title: 'Arquivos temporários',
    text: 'Sobras de instalações e programas, com mais de 24 horas.',
    on: true,
  },
  {
    id: 'cache',
    title: 'Caches e relatórios de erro do Windows',
    text: 'Miniaturas, cache de vídeo e relatórios de travamento. O Windows recria o que precisar.',
    on: true,
  },
  {
    id: 'browsers',
    title: 'Cache dos navegadores',
    text: 'Chrome, Edge, Brave e Firefox. Mantém senhas, logins, histórico e favoritos. Navegador aberto fica de fora.',
    on: true,
  },
  {
    id: 'systemTemp',
    title: 'Temporários do sistema',
    text: 'A pasta Temp do Windows, com mais de 24 horas.',
    admin: true,
    on: false,
  },
  {
    id: 'components',
    title: 'Limpar atualizações antigas do Windows',
    text: 'Usa a limpeza do próprio Windows. Pode levar de 5 a 20 minutos.',
    admin: true,
    on: false,
  },
  {
    id: 'repair',
    title: 'Procurar e consertar arquivos corrompidos',
    text: 'Roda DISM, SFC e a verificação do disco. Pode levar de 20 a 60 minutos e precisa de internet.',
    admin: true,
    on: false,
  },
];

const USER_IDS = CARE_ACTIONS.filter((a) => !a.admin).map((a) => a.id);
const ADMIN_IDS = CARE_ACTIONS.filter((a) => a.admin).map((a) => a.id);

/** Separa o que foi pedido em ações comuns e de administrador; id desconhecido é ignorado. */
export function planCare(ids) {
  const want = new Set(Array.isArray(ids) ? ids : []);
  return {
    user: USER_IDS.filter((id) => want.has(id)),
    admin: ADMIN_IDS.filter((id) => want.has(id)),
  };
}

// Anda pela pasta sem seguir junction/symlink e apaga (ou só soma) arquivos antigos.
const SWEEP_PS1 = String.raw`
$script:b = [int64]0; $script:n = 0; $script:s = 0
function Sweep([string]$root, [bool]$del, [int]$hours, [string]$mask = '*') {
  if (-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)) { return }
  $link = [IO.FileAttributes]::ReparsePoint
  $top = New-Object IO.DirectoryInfo($root)
  if ($top.Attributes -band $link) { return }
  $cut = (Get-Date).AddHours(-$hours)
  $st = New-Object System.Collections.Stack
  $st.Push($top)
  while ($st.Count) {
    $d = $st.Pop()
    try { $items = $d.GetFileSystemInfos() } catch { $script:s++; continue }
    foreach ($i in $items) {
      if ($i.Attributes -band $link) { continue }
      if ($i -is [IO.DirectoryInfo]) { $st.Push($i); continue }
      if ($mask -ne '*' -and $i.Name -notlike $mask) { continue }
      if ($i.LastWriteTime -gt $cut) { continue }
      try {
        $l = $i.Length
        if ($del) { $i.Delete() }
        $script:b += $l; $script:n++
      } catch { $script:s++ }
    }
  }
}
`;

const USER_PS1 =
  String.raw`$ErrorActionPreference = 'SilentlyContinue'
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'
` +
  SWEEP_PS1 +
  String.raw`
$L = $env:LOCALAPPDATA
$del = $env:COMANDOU_DELETE -eq '1'
$out = @{}
foreach ($g in ($env:COMANDOU_GROUPS -split ',')) {
  $script:b = [int64]0; $script:n = 0; $script:s = 0; $busy = @()
  if ($L -and $g -eq 'temp') { Sweep (Join-Path $L 'Temp') $del 24 }
  if ($L -and $g -eq 'cache') {
    foreach ($p in 'Microsoft\Windows\WER', 'CrashDumps', 'D3DSCache') { Sweep (Join-Path $L $p) $del 24 }
    Sweep (Join-Path $L 'Microsoft\Windows\Explorer') $del 24 'thumbcache_*.db'
  }
  if ($L -and $g -eq 'browsers') {
    $list = @(
      @('Chrome', 'chrome', 'Google\Chrome\User Data'),
      @('Edge', 'msedge', 'Microsoft\Edge\User Data'),
      @('Brave', 'brave', 'BraveSoftware\Brave-Browser\User Data')
    )
    foreach ($x in $list) {
      $data = Join-Path $L $x[2]
      if (-not (Test-Path -LiteralPath $data)) { continue }
      if ($del -and (Get-Process -Name $x[1] -ErrorAction SilentlyContinue)) { $busy += $x[0]; continue }
      foreach ($pf in @(Get-ChildItem -LiteralPath $data -Directory -Force | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' })) {
        foreach ($c in 'Cache', 'Code Cache', 'GPUCache') { Sweep (Join-Path $pf.FullName $c) $del 0 }
      }
    }
    $fx = Join-Path $L 'Mozilla\Firefox\Profiles'
    if (Test-Path -LiteralPath $fx) {
      if ($del -and (Get-Process -Name firefox -ErrorAction SilentlyContinue)) { $busy += 'Firefox' }
      else {
        foreach ($pf in @(Get-ChildItem -LiteralPath $fx -Directory -Force)) { Sweep (Join-Path $pf.FullName 'cache2') $del 0 }
      }
    }
  }
  $out[$g] = @{ bytes = $script:b; count = $script:n; skipped = $script:s; busy = @($busy) }
}
ConvertTo-Json -InputObject $out -Compress -Depth 4
`;

const CHECK_PS1 = String.raw`$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$c = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
$disks = @(Get-PhysicalDisk | ForEach-Object { @{ name = [string]$_.FriendlyName; health = [string]$_.HealthStatus; media = [string]$_.MediaType } })
$av = Get-MpComputerStatus
$reboot = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')
$o = @{
  windows = [string]$os.Caption
  diskFree = [int64]$c.FreeSpace; diskTotal = [int64]$c.Size
  ramTotal = [int64]$os.TotalVisibleMemorySize * 1024; ramFree = [int64]$os.FreePhysicalMemory * 1024
  uptimeDays = [math]::Floor(((Get-Date) - $os.LastBootUpTime).TotalDays)
  disks = $disks; rebootPending = [bool]$reboot
  defender = if ($av) { [bool]$av.RealTimeProtectionEnabled } else { $null }
  signatureAge = if ($av) { [int]$av.AntivirusSignatureAge } else { $null }
}
ConvertTo-Json -InputObject $o -Compress -Depth 4
`;

/**
 * Script do administrador, montado só com ids da lista. Responde pelo código de saída (sem
 * gravar arquivo): 1 = DISM não reparou, 2 = SFC falhou, 4 = disco com problema, 8 = limpeza falhou.
 */
export function elevatedScript(ids) {
  const { admin } = planCare(ids);
  const has = (id) => admin.includes(id);
  return [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `(Get-Process -Id $PID).PriorityClass = 'BelowNormal'`,
    SWEEP_PS1,
    `$r = 0`,
    has('systemTemp') ? String.raw`Sweep (Join-Path $env:SystemRoot 'Temp') $true 24` : '',
    has('components')
      ? String.raw`& "$env:SystemRoot\System32\Dism.exe" /Online /Cleanup-Image /StartComponentCleanup /Quiet /NoRestart | Out-Null
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) { $r = $r -bor 8 }`
      : '',
    has('repair')
      ? String.raw`& "$env:SystemRoot\System32\Dism.exe" /Online /Cleanup-Image /RestoreHealth /Quiet /NoRestart | Out-Null
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) { $r = $r -bor 1 }
& "$env:SystemRoot\System32\sfc.exe" /scannow | Out-Null
if ($LASTEXITCODE -ne 0) { $r = $r -bor 2 }
& "$env:SystemRoot\System32\chkdsk.exe" $env:SystemDrive /scan | Out-Null
if ($LASTEXITCODE -ne 0) { $r = $r -bor 4 }`
      : '',
    `exit $r`,
  ]
    .filter(Boolean)
    .join('\n');
}

const ELEVATE_PS1 = String.raw`$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$a = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ' + $env:COMANDOU_B64
try {
  $p = Start-Process -FilePath $ps -Verb RunAs -WindowStyle Hidden -ArgumentList $a -PassThru -ErrorAction Stop
  $null = $p.Handle
  $p.WaitForExit()
  Write-Output ('EXIT ' + $p.ExitCode)
} catch { Write-Output 'DENIED' }
`;

/** Lê o código de saída do administrador em frases para o relatório. */
export function elevatedReport(ids, code) {
  const { admin } = planCare(ids);
  const out = [];
  if (admin.includes('systemTemp'))
    out.push({ level: 'ok', title: 'Temporários do sistema limpos' });
  if (admin.includes('components'))
    out.push(
      code & 8
        ? { level: 'warn', title: 'O Windows não terminou a limpeza das atualizações antigas' }
        : { level: 'ok', title: 'Atualizações antigas limpas' },
    );
  if (admin.includes('repair')) {
    out.push(
      code & 1
        ? {
            level: 'warn',
            title: 'O DISM não conseguiu reparar a imagem do Windows',
            text: 'Confira a internet e rode de novo.',
          }
        : { level: 'ok', title: 'Imagem do Windows conferida (DISM)' },
    );
    out.push(
      code & 2
        ? {
            level: 'warn',
            title: 'O SFC achou algo que pode não ter consertado',
            text: 'Reinicie o computador e rode de novo.',
          }
        : { level: 'ok', title: 'Arquivos do sistema conferidos (SFC)' },
    );
    out.push(
      code & 4
        ? {
            level: 'danger',
            title: 'A verificação achou problema no disco',
            text: 'Faça backup dos arquivos importantes e leve a um técnico.',
          }
        : { level: 'ok', title: 'Disco verificado, sem erros' },
    );
  }
  return out;
}

/** Transforma os dados da checagem em avisos simples. */
export function healthFindings(d) {
  const out = [];
  const gb = (n) => `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0).replace('.', ',')} GB`;
  if (d.diskTotal > 0) {
    const pct = (d.diskFree / d.diskTotal) * 100;
    const text = `${gb(d.diskFree)} livres de ${gb(d.diskTotal)}.`;
    if (pct < 5 || d.diskFree < 5 * 1024 ** 3)
      out.push({ level: 'danger', title: 'Disco quase cheio', text });
    else if (pct < 15 || d.diskFree < 20 * 1024 ** 3)
      out.push({ level: 'warn', title: 'Pouco espaço no disco', text });
    else out.push({ level: 'ok', title: 'Espaço em disco bom', text });
  }
  const bad = (d.disks ?? []).filter((x) => x.health && !/^(healthy|íntegro)$/i.test(x.health));
  if (bad.length)
    out.push({
      level: 'danger',
      title: 'O disco avisa que pode falhar',
      text: `${bad.map((x) => x.name).join(', ')}. Faça backup e leve a um técnico.`,
    });
  else if (d.disks?.length) out.push({ level: 'ok', title: 'Saúde do disco boa' });
  if (d.ramTotal > 0) {
    const used = 1 - d.ramFree / d.ramTotal;
    const text = `${Math.round(used * 100)}% de ${gb(d.ramTotal)} em uso.`;
    out.push(
      used > 0.9
        ? { level: 'warn', title: 'Memória quase cheia', text: `${text} Feche o que não usa.` }
        : { level: 'ok', title: 'Memória boa', text },
    );
  }
  if (d.rebootPending)
    out.push({
      level: 'warn',
      title: 'O Windows pede para reiniciar',
      text: 'Reinicie fora do horário de pedidos para concluir as atualizações.',
    });
  else if (d.uptimeDays >= 14)
    out.push({
      level: 'warn',
      title: `Ligado há ${d.uptimeDays} dias sem reiniciar`,
      text: 'Reiniciar fora do horário de pedidos deixa o computador mais leve.',
    });
  if (d.defender === false)
    out.push({
      level: 'danger',
      title: 'Proteção em tempo real do Windows desligada',
      text: 'Se não houver outro antivírus, ligue em Segurança do Windows.',
    });
  else if (d.defender && d.signatureAge > 7)
    out.push({
      level: 'warn',
      title: 'Antivírus desatualizado',
      text: `Última atualização há ${d.signatureAge} dias.`,
    });
  else if (d.defender) out.push({ level: 'ok', title: 'Antivírus ligado e em dia' });
  const rank = { danger: 0, warn: 1, ok: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

async function sweepUser(groups, del, env) {
  if (!groups.length) return {};
  const raw = await powershell(
    USER_PS1,
    { ...env, COMANDOU_GROUPS: groups.join(','), COMANDOU_DELETE: del ? '1' : '0' },
    20 * 60_000,
  );
  return JSON.parse(raw.trim() || '{}');
}

/** Checagem completa: não apaga nem muda nada. */
export async function careCheck({ env } = {}) {
  const [raw, sizes] = await Promise.all([
    powershell(CHECK_PS1, env, 60_000),
    sweepUser(USER_IDS, false, env),
  ]);
  const data = JSON.parse(raw.trim() || '{}');
  return {
    windows: data.windows ?? '',
    findings: healthFindings(data),
    actions: CARE_ACTIONS.map((a) => ({ ...a, bytes: sizes[a.id]?.bytes ?? null })),
  };
}

/** Roda o que foi escolhido. `onStep` conta em que parte está. */
export async function careRun(ids, { onStep = () => {}, env } = {}) {
  const plan = planCare(ids);
  const before = await diskFree(env);
  const items = [];
  let freed = 0;
  if (plan.user.length) {
    onStep('Limpando arquivos temporários e caches…');
    const r = await sweepUser(plan.user, true, env);
    for (const id of plan.user) {
      const x = r[id] ?? { bytes: 0, count: 0, skipped: 0, busy: [] };
      freed += x.bytes;
      const title = CARE_ACTIONS.find((a) => a.id === id).title;
      const busy = [x.busy ?? []].flat();
      items.push({
        level: busy.length ? 'warn' : 'ok',
        title,
        text: `${x.count} arquivo${x.count === 1 ? '' : 's'} apagado${x.count === 1 ? '' : 's'}${x.skipped ? `, ${x.skipped} em uso ficaram` : ''}.${busy.length ? ` ${busy.join(', ')} aberto: feche e rode de novo para limpar.` : ''}`,
        bytes: x.bytes,
      });
    }
  }
  let denied = false;
  if (plan.admin.length) {
    onStep(
      plan.admin.includes('repair')
        ? 'Procurando arquivos corrompidos. Pode levar até uma hora; a impressão continua funcionando.'
        : 'Limpando o sistema. Pode levar alguns minutos; a impressão continua funcionando.',
    );
    const b64 = Buffer.from(elevatedScript(plan.admin), 'utf16le').toString('base64');
    const out = await powershell(ELEVATE_PS1, { ...env, COMANDOU_B64: b64 }, 3 * 60 * 60_000);
    const m = /EXIT (\d+)/.exec(out);
    if (!m) {
      denied = true;
      items.push({
        level: 'warn',
        title: 'Limpeza do sistema não rodou',
        text: 'A permissão do Windows foi recusada.',
      });
    } else items.push(...elevatedReport(plan.admin, Number(m[1])));
  }
  const after = await diskFree(env);
  // O administrador não conta bytes: a diferença do disco cobre o que ele liberou.
  const total = plan.admin.length && !denied ? Math.max(freed, after - before) : freed;
  return { freed: total, items, denied };
}

async function diskFree(env) {
  const raw = await powershell(
    `(Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")).FreeSpace`,
    env,
    20_000,
  ).catch(() => '');
  return Number(raw.trim()) || 0;
}
