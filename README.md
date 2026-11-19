# Barbearia Navalha de Ouro

Sistema web completo de barbearia: site com agendamento online, planos mensais de cortes e barbas, loja, programa de fidelidade e três painéis (cliente, barbeiro e administrador). Feito com Node.js + Express + SQLite, front-end em HTML/JS puro, tema escuro com dourado.

## Como rodar

```bash
npm install
npm start          # http://localhost:3000
npm test           # testes de fumaça do backend
```

- Requer **Node 22.13 ou mais novo** (usa o `node:sqlite` embutido, sem compilar nada).
- O banco `barbearia.db` é criado e populado na primeira execução, com serviços, barbeiros, planos, produtos, comodidades e recompensas de exemplo.
- Porta alternativa: variável de ambiente `PORT`.

## Contas (3 perfis)

| Perfil | Login | Senha | Painel |
|---|---|---|---|
| Administrador | `admin@barbearia.com` | `admin123` | `/admin` |
| Barbeiro (vê só a própria agenda) | `rafael@barbearia.com`, `bruno@barbearia.com`, `diego@barbearia.com` | `barbeiro123` | `/barbeiro` |
| Cliente | `cliente@barbearia.com` (ou cadastre-se em `/`) | `cliente123` | `/cliente` |

O botão Entrar do site é único e leva cada perfil ao seu painel. O admin cria ou troca o login de cada barbeiro em Admin → Barbeiros → "Conta de login".

## Telas

| URL | O que tem |
|---|---|
| `/` | Site público: serviços, planos, equipe com notas, loja, comodidades, fidelidade, avaliações e agendamento em 4 passos |
| `/cliente` | Resumo, agendamentos (cancelar, avaliar, WhatsApp), plano com créditos usados, fidelidade e resgates, pedidos da loja, perfil |
| `/barbeiro` | Agenda própria por dia (confirmar, concluir, faltou, WhatsApp), indicadores, avaliações recebidas, perfil e senha |
| `/admin` | Dashboard, agenda, clientes, assinaturas, pagamentos, cadastro de serviços, barbeiros, planos, produtos, recompensas e comodidades, pedidos, resgates, avaliações, configurações |

## Regras de negócio

- Horários de 30 em 30 min; conflito por barbeiro e duração é bloqueado dentro de transação.
- Plano mensal (30 dias): cortes e barbas são créditos. "Corte + Barba" consome 1 de cada. Cancelar o agendamento devolve o crédito. O cliente cancela até 2 h antes.
- Pagamento do plano é **simulado** (Pix ou cartão): registra o pagamento, não cobra de verdade.
- Fidelidade: pontos por visita concluída (padrão 10, configurável, uma vez por atendimento) e +5 por avaliação. O resgate abate pontos e o admin marca como usado.
- Avaliação só de atendimento concluído, uma por atendimento.
- Loja: a reserva baixa o estoque; retirada e pagamento na barbearia.
- WhatsApp: links `wa.me` para confirmação e lembrete, sem API paga. Configure o número em Admin → Configurações (só dígitos com DDI, ex.: `5511999999999`).

## Estrutura

```
server.js          API (Express): auth, cliente, barbeiro, admin
db.js              Esquema SQLite, dados de exemplo e contas de demonstração
public/            Front-end (index, cliente, barbeiro, admin; app.css e JS por página)
test/smoke.test.js Testes de fumaça (node --test)
```

## Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `PORT` | Porta do servidor (padrão 3000) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Admin criado na primeira execução |
| `SEED_DEMO=0` | Não cria as contas de demonstração (cliente e barbeiros) |
| `DB_PATH` | Caminho do banco (`:memory:` nos testes) |

## Segurança

Senhas com scrypt; sessão em cookie HttpOnly/SameSite; rejeição de Origin cruzada; limite de tentativas de login; SQL parametrizado; escape de todo HTML dinâmico; CSP sem script inline; permissões por perfil validadas no servidor.

### Antes de publicar

1. Defina `ADMIN_EMAIL` e `ADMIN_PASSWORD` antes da primeira execução e use `SEED_DEMO=0`.
2. Troque ou apague as contas de demonstração.
3. Sirva por HTTPS e adicione a flag `Secure` ao cookie de sessão (`server.js`).
4. Substitua a simulação de pagamento por uma integração real.
5. Faça backup periódico de `barbearia.db`.

## Prompt usado para criar a aplicação

```text
Crie um sistema web de baberia, com um layout bonito e com todas as funç~~oes necessarios para agendamento, painel administrativo, paine do cliente e planos de cortes ebarb. Além dos serviços oferecidos ec omodidade.
```
