/* Garante autorização real pelo banco antes de habilitar a interface administrativa. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', async () => {
    const gate = document.getElementById('sessionGate');
    function error(message) {gate.textContent=message; gate.setAttribute('role','alert');}
    const supa = window.OrchestraDB;
    if (!supa?.ready) {error(supa?.error || 'Configure o Supabase em assets/js/config.js.');return;}
    try {
      const {data:{user},error: authError} = await supa.client.auth.getUser();
      if (authError || !user) {location.replace('entrar.html');return;}
      const {data:authorized,error:adminError} = await supa.client.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle();
      if (adminError || !authorized) {await supa.client.auth.signOut();location.replace('entrar.html?acesso=negado');return;}
      document.body.classList.add('authenticated');
      document.dispatchEvent(new Event('orchestra:authorized'));
      document.getElementById('logoutButton')?.addEventListener('click', async () => {
        await supa.client.auth.signOut();location.replace('entrar.html');
      });
    } catch(ex) {error('Falha na validação de acesso. Verifique a conexão e tente recarregar.');}
  });
})();
