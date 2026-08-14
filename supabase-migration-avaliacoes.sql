-- Migração: avaliação de clientes por atividade.
-- Rode isso no SQL Editor do Supabase (projeto já tem as tabelas op_* criadas
-- pelo supabase-schema.sql original — este script só adiciona colunas novas).

create extension if not exists pgcrypto;

alter table op_atividades
  add column if not exists cliente_nome text not null default '',
  add column if not exists cliente_whatsapp text not null default '',
  add column if not exists avaliacao_token uuid not null default gen_random_uuid() unique,
  add column if not exists avaliacao_nota smallint check (avaliacao_nota between 1 and 5),
  add column if not exists avaliacao_resolveu boolean,
  add column if not exists avaliacao_comentario text not null default '',
  add column if not exists avaliacao_respondida_em timestamptz;
