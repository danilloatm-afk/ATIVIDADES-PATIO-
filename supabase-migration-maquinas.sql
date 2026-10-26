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

-- 5) Horímetro: leituras de início e fim de cada mês, enviadas pelo operador
-- por um link próprio de cada máquina (sem login). Horas trabalhadas no mês
-- = leitura do fim - leitura do início.
alter table op_maquinas add column if not exists horimetro_token uuid not null default gen_random_uuid();
create unique index if not exists op_maquinas_horimetro_token_idx on op_maquinas (horimetro_token);

create table if not exists op_horimetros (
  id bigint generated always as identity primary key,
  maquina_id bigint not null references op_maquinas(id) on delete cascade,
  mes date not null,                      -- sempre o dia 1 do mês
  tipo text not null check (tipo in ('inicio', 'fim')),
  valor numeric(12, 1) not null check (valor >= 0),
  operador text not null default '',
  registrado_em timestamptz not null default now(),
  unique (maquina_id, mes, tipo)
);

alter table op_horimetros enable row level security;
drop policy if exists "leitura horimetros" on op_horimetros;
drop policy if exists "cria horimetros" on op_horimetros;
drop policy if exists "atualiza horimetros" on op_horimetros;

-- Painel (logado): admin vê tudo; líder só as máquinas dos seus setores.
create policy "leitura horimetros" on op_horimetros for select to authenticated
  using (exists (select 1 from op_maquinas m where m.id = maquina_id and (op_is_admin() or m.setor_id = any(op_meus_setores()))));
create policy "cria horimetros" on op_horimetros for insert to authenticated
  with check (exists (select 1 from op_maquinas m where m.id = maquina_id and (op_is_admin() or m.setor_id = any(op_meus_setores()))));
create policy "atualiza horimetros" on op_horimetros for update to authenticated
  using (exists (select 1 from op_maquinas m where m.id = maquina_id and (op_is_admin() or m.setor_id = any(op_meus_setores()))))
  with check (exists (select 1 from op_maquinas m where m.id = maquina_id and (op_is_admin() or m.setor_id = any(op_meus_setores()))));

-- Operador (sem login): só passa por estas duas funções, e só com o código
-- secreto da máquina. Não existe acesso direto às tabelas para anônimo.
create or replace function op_horimetro_info(p_token uuid)
returns json
language plpgsql security definer stable
set search_path = public
as $$
declare m op_maquinas;
begin
  select * into m from op_maquinas where horimetro_token = p_token and ativo;
  if not found then return null; end if;
  return json_build_object(
    'codigo', m.codigo,
    'modelo', m.modelo,
    'leituras', coalesce((
      select json_agg(json_build_object('mes', h.mes, 'tipo', h.tipo, 'valor', h.valor) order by h.mes desc, h.tipo)
      from (select * from op_horimetros where maquina_id = m.id order by mes desc, tipo limit 6) h
    ), '[]'::json)
  );
end $$;

create or replace function op_horimetro_registrar(p_token uuid, p_mes date, p_tipo text, p_valor numeric, p_operador text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  m op_maquinas;
  mes_ref date := date_trunc('month', p_mes)::date;
  mes_atual date := date_trunc('month', current_date)::date;
  outro numeric;
begin
  select * into m from op_maquinas where horimetro_token = p_token and ativo;
  if not found then raise exception 'Link inválido ou máquina desativada.'; end if;
  if p_tipo not in ('inicio', 'fim') then raise exception 'Tipo de leitura inválido.'; end if;
  if p_valor is null or p_valor < 0 then raise exception 'Horímetro inválido.'; end if;
  if coalesce(trim(p_operador), '') = '' then raise exception 'Informe o seu nome.'; end if;
  if mes_ref > mes_atual or mes_ref < (mes_atual - interval '3 months')::date then
    raise exception 'Mês fora do período permitido.';
  end if;

  -- Confere com a outra leitura do mesmo mês (se já existir): o final não
  -- pode ser menor que o inicial, e um mês não passa de 744 horas.
  select valor into outro from op_horimetros
    where maquina_id = m.id and mes = mes_ref and tipo = case when p_tipo = 'fim' then 'inicio' else 'fim' end;
  if outro is not null then
    if p_tipo = 'fim' and p_valor < outro then
      raise exception 'O horímetro do final do mês (%) não pode ser menor que o do início (%).', p_valor, outro;
    end if;
    if p_tipo = 'inicio' and p_valor > outro then
      raise exception 'O horímetro do início do mês (%) não pode ser maior que o do final (%).', p_valor, outro;
    end if;
    if abs(p_valor - outro) > 744 then
      raise exception 'A diferença entre início e final passa de 744 horas (um mês inteiro). Confira o número digitado.';
    end if;
  end if;

  insert into op_horimetros (maquina_id, mes, tipo, valor, operador)
    values (m.id, mes_ref, p_tipo, p_valor, trim(p_operador))
    on conflict (maquina_id, mes, tipo)
    do update set valor = excluded.valor, operador = excluded.operador, registrado_em = now();

  return json_build_object('ok', true);
end $$;

revoke all on function op_horimetro_info(uuid) from public;
revoke all on function op_horimetro_registrar(uuid, date, text, numeric, text) from public;
grant execute on function op_horimetro_info(uuid) to anon, authenticated;
grant execute on function op_horimetro_registrar(uuid, date, text, numeric, text) to anon, authenticated;

-- 6) Conferência: deve listar as 8 máquinas, cada uma com seu código de horímetro
select m.codigo, m.modelo, m.prestador, s.nome as setor, m.horimetro_token
from op_maquinas m join op_setores s on s.id = m.setor_id
order by m.codigo;
