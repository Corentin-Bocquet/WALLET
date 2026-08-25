-- ============================================================================
-- WALLET · 0009 · Privilèges explicites
--   Supabase accorde par défaut des droits larges au rôle "authenticated" via
--   ALTER DEFAULT PRIVILEGES. On ne s'en remet pas à ça : on déclare ici
--   exactement ce qui est permis, table par table. La RLS reste la barrière
--   qui décide QUELLES lignes ; ces grants décident QUELLES opérations.
-- ============================================================================

revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

grant usage on schema public to anon, authenticated, service_role;

-- Référentiel de marché : lecture seule pour les utilisateurs connectés -------
do $$
declare t text;
begin
  foreach t in array array['assets','asset_quotes','price_history',
                           'market_indicators','fx_rates','glossary','sync_state'] loop
    execute format('revoke all on public.%I from authenticated;', t);
    execute format('grant select on public.%I to authenticated;', t);
  end loop;
end $$;

-- Données personnelles : CRUD, borné par la RLS ------------------------------
do $$
declare t text;
declare owned text[] := array[
  'profiles','user_settings','accounts','holdings','portfolio_snapshots',
  'asset_watchlist','investment_transactions','categories','bank_transactions',
  'category_rules','category_corrections','category_memory','ignore_memory',
  'recurring_transactions','import_batches','score_models','investment_scores',
  'scenarios','alt_ratios','goals','alerts','alert_events','insights','backtests',
  'assistant_messages'
];
begin
  foreach t in array owned loop
    execute format('revoke all on public.%I from authenticated;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;

-- provider_credentials : aucun accès direct depuis le client.
--   Écriture via l'Edge Function (service_role), lecture via la RPC "safe".
revoke all on public.provider_credentials from authenticated, anon;
grant select on public.provider_credentials_safe to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
