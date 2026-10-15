(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    const status = document.getElementById('loginStatus');
    const button = document.getElementById('submitLogin');
    const supa = window.OrchestraDB;
    if (!supa?.ready) {status.textContent = supa?.error || 'Supabase não configurado.';return;}
    if (new URLSearchParams(location.search).get('acesso') === 'negado') status.textContent='Conta sem permissão administrativa.';
    form.addEventListener('submit', async event => {
      event.preventDefault();button.disabled=true;status.textContent='Verificando credenciais...';
      try {
        const {data,error} = await supa.client.auth.signInWithPassword({
          email:document.getElementById('loginEmail').value.trim(),
          password:document.getElementById('loginPassword').value
        });
        if (error) throw error;
        const {data:admin,error:permissionError} = await supa.client.from('admin_users').select('user_id').eq('user_id',data.user.id).maybeSingle();
        if (permissionError || !admin) {await supa.client.auth.signOut();throw Error('Sua conta não está autorizada a editar os registros.');}
        location.replace('painel.html');
      } catch(err) {status.textContent=err.message || 'Não foi possível entrar.';button.disabled=false;}
    });
  });
})();
