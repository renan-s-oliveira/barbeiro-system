# Barbearia Navalha de Ouro

Sistema web completo de barbearia: site com agendamento online, planos mensais de cortes e barbas, loja, programa de fidelidade e três painéis (cliente, barbeiro e administrador). Feito com Node.js + Express + SQLite, front-end em HTML/JS puro, tema escuro com dourado.

## Como iniciar o projeto

1. Instale o **Node.js 22.13 ou mais novo** (o projeto usa o `node:sqlite` embutido, não precisa compilar nada nem instalar banco).
2. Clone o repositório e entre na pasta:

   ```bash
   git clone https://github.com/renan-s-oliveira/barbeiro-system.git
   cd barbeiro-system
   ```

3. Instale as dependências e inicie:

   ```bash
   npm install
   npm start          # http://localhost:3000
   ```

4. Abra http://localhost:3000 no navegador e entre com uma das contas abaixo.
5. (Opcional) Rode os testes do backend: `npm test`.

Na **primeira execução** o banco `barbearia.db` é criado sozinho e já vem com:

- **Usuários criados automaticamente:** 1 administrador, 3 barbeiros e 1 cliente (tabela na próxima seção);
- 8 serviços, 4 planos, 6 produtos, 6 comodidades e 3 recompensas de exemplo.

Para voltar ao estado inicial, pare o servidor e apague os arquivos `barbearia.db*`; um banco novo é criado ao iniciar. Para usar outra porta, defina a variável `PORT`.

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

## Criado com IA e testado por um Harness próprio

Este projeto foi criado **inteiramente com IA** (Claude Code), a partir de pedidos em linguagem natural: não há código escrito à mão. O desenvolvimento rodou sobre um **Harness próprio**, um servidor MCP que governa e audita o trabalho da IA: grava arquivos e executa comandos por ferramentas controladas, registra a demanda e roda as verificações de segurança.

O que foi verificado nesta versão:

- **Varredura de vulnerabilidades pelo Harness** (SAST e busca de segredos) nos arquivos do servidor e do front-end. Resultado: 30 alertas, que foram analisados um a um. O alerta de severidade alta ("credencial em texto claro") é falso positivo, causado pelo atributo `autocomplete="new-password"` de um campo de senha. Os 29 de severidade média são avisos genéricos de XSS: todo dado dinâmico já passa por escape (`esc()`), e os poucos números e horários gerados pelo servidor ainda sem escape foram escapados também.
- **Análise de dependências (SCA)** não pôde rodar: o projeto não tinha lockfile no escopo naquele momento. Rode `npm audit` para conferir as dependências.
- **Revisão red team / blue team** do Harness não chegou a executar, porque as ferramentas recusaram o formato dos parâmetros enviados. Portanto não há relatório dessa revisão.
- **Testes automatizados** (`npm test`): cobrem o fluxo completo (cadastro, plano, agendamento, conclusão, pontos, avaliação, loja), o isolamento do perfil de barbeiro e controles básicos (401 sem login, 403 para origem cruzada, validação de entrada).

A IA pode errar. Trate esta aplicação como ponto de partida: revise o código e faça um teste de segurança independente antes de colocar dados reais em produção.

## Como reportar vulnerabilidades

Encontrou uma falha de segurança? **Reporte abrindo uma issue** no repositório:

1. Acesse https://github.com/renan-s-oliveira/barbeiro-system/issues/new/choose.
2. Escolha o modelo **Relato de vulnerabilidade** (ele já vem com o rótulo `security` e com os campos abaixo).
3. Preencha e envie.

A issue é pública: **não inclua senhas, tokens, dados de clientes reais nem um exploit pronto para uso**. Descreva o mínimo necessário para reproduzir. Se a falha for grave a ponto de não poder ficar pública, abra a issue apenas com o título e a severidade, sem detalhes, e aguarde o contato do mantenedor.

Inclua no relato:

- **Resumo** e o **impacto** (o que um atacante consegue fazer);
- **Onde**: arquivo e linha, ou rota (ex.: `POST /api/appointments`);
- **Passos para reproduzir**, com a requisição ou o trecho de código mínimo;
- **Severidade** estimada (crítica, alta, média ou baixa) e, se souber, o CWE;
- **Versão** (commit) e ambiente em que testou;
- **Sugestão de correção**, se tiver.

Teste apenas na sua própria instalação local, sem acessar dados de terceiros nem causar indisponibilidade. Não publique a falha antes de ela ser corrigida.

## Prompt usado para criar a aplicação

```text
Crie um sistema web de baberia, com um layout bonito e com todas as funç~~oes necessarios para agendamento, painel administrativo, paine do cliente e planos de cortes ebarb. Além dos serviços oferecidos ec omodidade.
```
