/* Cliente único Supabase. Apenas credenciais PÚBLICAS são aceitas aqui. */
(() => {
  'use strict';
  const config = window.ORCHESTRA_CONFIG || {};
  const ready = /^https:\/\/[\w-]+\.supabase\.co\/?$/.test(config.supabaseUrl || '')
    && /^(sb_publishable_|eyJ)/.test(config.publishableKey || '');
  const error = !ready ? 'Configure a URL do projeto e a chave publishable em assets/js/config.js.' :
    !window.supabase?.createClient ? 'Biblioteca Supabase não carregou. Verifique a conexão com a internet.' : '';
  const client = !error ? window.supabase.createClient(config.supabaseUrl.replace(/\/$/, ''), config.publishableKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, storage: window.sessionStorage }
  }) : null;
  window.OrchestraDB = Object.freeze({client, error, ready: Boolean(client)});
})();
