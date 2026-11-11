/**
 * Baixa um arquivo da API sem sair da tela. Busca com a sessão do usuário e entrega como
 * download; funciona também no app instalado (PWA), onde um link direto para a API abria uma
 * página em branco ou não baixava nada. Erro da API vira mensagem (não um arquivo quebrado).
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    let message = 'Não deu para gerar o arquivo. Tente de novo.';
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* resposta sem JSON: fica a mensagem padrão */
    }
    throw new Error(message);
  }
  const header = res.headers.get('Content-Disposition') ?? '';
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  const plain = /filename="([^"]+)"/i.exec(header)?.[1];
  const name = utf ? decodeURIComponent(utf) : (plain ?? fallbackName);
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // O navegador precisa do endereço vivo até começar a salvar.
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}
