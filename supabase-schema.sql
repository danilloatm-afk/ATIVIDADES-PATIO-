-- Schema do "Painel de Operações" no mesmo projeto Supabase do Contas
-- Mensais / Controle de Bebedouros. Tabelas prefixadas com op_ para não
-- colidir com as tabelas dos outros apps (bd_..., contas, gastos, etc).
--
-- NOTA: as colunas de cliente/avaliação foram adicionadas depois, via
-- supabase-migration-avaliacoes.sql. Se você está rodando este arquivo do
-- zero num projeto novo, não precisa rodar a migração separada — as colunas
-- já estão incluídas abaixo.

create extension if not exists pgcrypto;

create table op_funcionarios (
  id bigint generated always as identity primary key,
  nome text not null,
  cargo text not null default '',
  ativo boolean not null default true
);

create table op_categorias (
  id bigint generated always as identity primary key,
  nome text not null,
  ativo boolean not null default true
);

create table op_atividades (
  id bigint generated always as identity primary key,
  funcionario_id bigint not null references op_funcionarios(id),
  categoria_id bigint references op_categorias(id),
  titulo text not null,
  descricao text not null default '',
  prioridade text not null default 'media' check (prioridade in ('baixa', 'media', 'alta')),
  status text not null default 'aberto' check (status in ('aberto', 'andamento', 'concluido')),
  data_abertura date not null default current_date,
  prazo date,
  data_conclusao timestamptz,
  observacao text not null default '',
  criado_em timestamptz not null default now(),
  cliente_nome text not null default '',
  cliente_whatsapp text not null default '',
  avaliacao_token uuid not null default gen_random_uuid() unique,
  avaliacao_nota smallint check (avaliacao_nota between 1 and 5),
  avaliacao_resolveu boolean,
  avaliacao_comentario text not null default '',
  avaliacao_respondida_em timestamptz
);

-- Libera leitura/escrita (mesmo critério dos outros apps: sem login, só
-- quem tiver a URL + chave do projeto consegue acessar os dados).
alter table op_funcionarios enable row level security;
alter table op_categorias enable row level security;
alter table op_atividades enable row level security;

create policy "allow all" on op_funcionarios for all using (true) with check (true);
create policy "allow all" on op_categorias for all using (true) with check (true);
create policy "allow all" on op_atividades for all using (true) with check (true);

-- Categorias iniciais (opcional, edite/remova como quiser em Configurações).
insert into op_categorias (nome) values
  ('Manutenção'), ('Chamado/Suporte'), ('Instalação'), ('Limpeza/Organização'), ('Outros');
