-- Migração: cadastro de máquinas por setor (ex.: Terraplanagem) com o local
-- onde cada uma está trabalhando e o histórico de mudanças de local.
-- Pode rodar mais de uma vez sem duplicar nada.

-- 1) Setor Terraplanagem (se ainda não existir)
insert into op_setores (nome)
  select 'Terraplanagem' where not exists (select 1 from op_setores where nome = 'Terraplanagem');

-- 2) Tabelas
create table if not exists op_maquinas (
  id bigint generated always as identity primary key,
  setor_id bigint not null references op_setores(id),
  codigo text not null,
  modelo text not null default '',
  prestador text not null default '',
  local_atual text not null default '',
  local_desde timestamptz,
  ativo boolean not null default true,
  unique (setor_id, codigo)
);

create table if not exists op_maquinas_historico (
  id bigint generated always as identity primary key,
  maquina_id bigint not null references op_maquinas(id) on delete cascade,
  local text not null,
  em timestamptz not null default now()
);

-- 3) Acesso: admin vê/mexe em tudo; líder só nas máquinas dos seus setores
alter table op_maquinas enable row level security;
alter table op_maquinas_historico enable row level security;

drop policy if exists "leitura maquinas" on op_maquinas;
drop policy if exists "cria maquinas" on op_maquinas;
drop policy if exists "atualiza maquinas" on op_maquinas;
drop policy if exists "leitura historico maquinas" on op_maquinas_historico;
drop policy if exists "cria historico maquinas" on op_maquinas_historico;

create policy "leitura maquinas" on op_maquinas for select to authenticated
  using (op_is_admin() or setor_id = any(op_meus_setores()));
create policy "cria maquinas" on op_maquinas for insert to authenticated
  with check (op_is_admin() or setor_id = any(op_meus_setores()));
create policy "atualiza maquinas" on op_maquinas for update to authenticated
  using (op_is_admin() or setor_id = any(op_meus_setores()))
  with check (op_is_admin() or setor_id = any(op_meus_setores()));

create policy "leitura historico maquinas" on op_maquinas_historico for select to authenticated
  using (exists (select 1 from op_maquinas m where m.id = maquina_id and (op_is_admin() or m.setor_id = any(op_meus_setores()))));
create policy "cria historico maquinas" on op_maquinas_historico for insert to authenticated
  with check (exists (select 1 from op_maquinas m where m.id = maquina_id and (op_is_admin() or m.setor_id = any(op_meus_setores()))));

-- 4) Máquinas já conhecidas da Terraplanagem
insert into op_maquinas (setor_id, codigo, modelo, prestador)
select s.id, v.codigo, v.modelo, v.prestador
from op_setores s,
  (values
    ('TT-031', 'KOMATSU D30', 'MARQUELLI CINTRA LAQUIZ'),
    ('TT-032', 'FIATALLIS 7D', 'MARQUELLI CINTRA LAQUIZ'),
    ('TT-054', 'MOTONIVELADORA CATERPILLAR 140', 'LAQUIZ TRATORES EIRELI-ME'),
    ('TT-067', 'ESCAVADEIRA PC 200 LC', 'LAQUIZ TRATORES EIRELI-ME'),
    ('TT-337', 'KOMATSU PC200', 'LAQUIZ TRATORES EIRELI-ME'),
    ('TT-403', 'KOMATSU PC210', 'LAQUIZ TRATORES EIRELI-ME'),
    ('TT-546', 'CASE 621E', 'LAQUIZ TRATORES EIRELI-ME'),
    ('TT-321', 'ESCAVADEIRA JD 210G', 'LAQUIZ TRATORES EIRELI-ME')
  ) as v(codigo, modelo, prestador)
where s.nome = 'Terraplanagem'
on conflict (setor_id, codigo) do nothing;

-- 5) Conferência: deve listar as 8 máquinas
select m.codigo, m.modelo, m.prestador, s.nome as setor
from op_maquinas m join op_setores s on s.id = m.setor_id
order by m.codigo;
