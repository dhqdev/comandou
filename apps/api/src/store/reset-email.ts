/**
 * E-mail com o código para o cliente criar uma nova senha no cardápio online. Sai com o nome do
 * restaurante (o cliente conhece a loja, não o Comandou). O desenho fica com os outros e-mails em
 * `mail/templates`.
 */
export { customerResetEmail as resetEmail } from '../mail/templates/emails';
export type { CustomerResetInput as ResetEmailInput } from '../mail/templates/emails';
