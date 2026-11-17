/* CONECTA - funcoes compartilhadas por todas as telas */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(url, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) { init.method = opts.method || 'POST'; init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const r = await fetch(url, init);
    if (r.status === 401) { location.href = '/login.html'; throw new Error('Sessão expirada.'); }
    let d = {};
    try { d = await r.json(); } catch (e) { /* resposta sem corpo */ }
    if (!r.ok) throw new Error(d.erro || 'Erro ' + r.status);
    return d;
  }

  const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—';
  const iniciais = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const cnpjF = c => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const cpfF = c => String(c || '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

  function toast(msg, erro) {
    const t = document.createElement('div');
    t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg; t.setAttribute('role', 'status');
    document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
  }

  // ---------- upload de PDF (arrastar e soltar) ----------
  const MAX_MB = 8;
  function lerArquivo(file) {
    return new Promise((resolve, reject) => {
      if (!/\.pdf$/i.test(file.name)) return reject(new Error('Envie um arquivo PDF.'));
      if (file.size > MAX_MB * 1024 * 1024) return reject(new Error('O PDF deve ter no máximo ' + MAX_MB + ' MB.'));
      const fr = new FileReader();
      fr.onload = () => resolve({ nome: file.name, base64: String(fr.result).split(',')[1] });
      fr.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      fr.readAsDataURL(file);
    });
  }
  function dropzone(container, rotulo) {
    container.innerHTML = '<div class="dropzone" tabindex="0" role="button"><div>📎 <b>' + esc(rotulo || 'Arraste o PDF aqui') + '</b><br><span class="muted">ou clique para selecionar (PDF, até ' + MAX_MB + ' MB)</span></div></div><input type="file" accept="application/pdf,.pdf" hidden>';
    const zona = container.querySelector('.dropzone'), input = container.querySelector('input');
    const estado = { arquivo: null };
    async function receber(file) {
      if (!file) return;
      try {
        estado.arquivo = await lerArquivo(file);
        zona.classList.add('cheio'); zona.innerHTML = '✅ <b>' + esc(file.name) + '</b><br><span class="muted">clique para trocar</span>';
      } catch (e) { toast(e.message, true); }
    }
    zona.addEventListener('click', () => input.click());
    zona.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => receber(input.files[0]));
    ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove('sobre'); }));
    zona.addEventListener('drop', e => receber(e.dataTransfer.files[0]));
    return estado;
  }

  // ---------- janela (modal) com formulario ----------
  // opcoes: titulo, campos:[{id,rotulo,tipo,valor,obrigatorio,opcoes:[{v,t}]}], arquivo:{rotulo,obrigatorio}, botao, enviar(valores, arquivo)
  function formModal(o) {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    const campos = (o.campos || []).map(c => {
      const id = 'fm_' + c.id;
      let ctl;
      if (c.tipo === 'select') ctl = '<select id="' + id + '">' + (c.opcoes || []).map(x => '<option value="' + esc(x.v) + '"' + (String(x.v) === String(c.valor) ? ' selected' : '') + '>' + esc(x.t) + '</option>').join('') + '</select>';
      else if (c.tipo === 'textarea') ctl = '<textarea id="' + id + '" rows="3" maxlength="' + (c.maxlength || 200) + '" style="width:100%;padding:10px;border:1px solid var(--borda);border-radius:10px;font:inherit">' + esc(c.valor ?? '') + '</textarea>';
      else ctl = '<input id="' + id + '" type="' + (c.tipo || 'text') + '" value="' + esc(c.valor ?? '') + '"' + (c.step ? ' step="' + c.step + '"' : '') + (c.maxlength ? ' maxlength="' + c.maxlength + '"' : '') + '>';
      return '<label class="campo"><span>' + esc(c.rotulo) + (c.obrigatorio ? ' *' : '') + '</span>' + ctl + '</label>';
    }).join('');
    fundo.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h3>' + esc(o.titulo) + '</h3><form>' + campos +
      (o.arquivo ? '<div class="campo"><span>' + esc(o.arquivo.rotulo || 'Arquivo PDF') + (o.arquivo.obrigatorio ? ' *' : '') + '</span><div id="fm_dz"></div></div>' : '') +
      '<div id="fm_erro"></div><div class="acoes"><button type="button" class="btn sec" id="fm_cancelar">Cancelar</button><button class="btn">' + esc(o.botao || 'Salvar') + '</button></div></form></div>';
    document.body.appendChild(fundo);
    const dz = o.arquivo ? dropzone(fundo.querySelector('#fm_dz'), o.arquivo.rotulo) : null;
    const fechar = () => fundo.remove();
    fundo.querySelector('#fm_cancelar').onclick = fechar;
    fundo.addEventListener('mousedown', e => { if (e.target === fundo) fechar(); });
    const primeiro = fundo.querySelector('input,select,textarea'); if (primeiro) primeiro.focus();
    fundo.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const caixa = fundo.querySelector('#fm_erro'); caixa.innerHTML = '';
      const valores = {};
      for (const c of (o.campos || [])) {
        valores[c.id] = fundo.querySelector('#fm_' + c.id).value;
        if (c.obrigatorio && !String(valores[c.id]).trim()) { caixa.innerHTML = '<div class="msg-erro">Preencha: ' + esc(c.rotulo) + '</div>'; return; }
      }
      if (o.arquivo && o.arquivo.obrigatorio && !dz.arquivo) { caixa.innerHTML = '<div class="msg-erro">Anexe o arquivo PDF.</div>'; return; }
      const btn = fundo.querySelector('form .btn:last-child'); btn.disabled = true;
      try { await o.enviar(valores, dz ? dz.arquivo : null); fechar(); }
      catch (err) { caixa.innerHTML = '<div class="msg-erro">' + esc(err.message) + '</div>'; btn.disabled = false; }
    });
    return fundo;
  }

  // ---------- acessibilidade ----------
  const A11Y_KEY = 'conecta_a11y';
  const a11y = { fonte: 0, contraste: false, leitor: false };
  try { Object.assign(a11y, JSON.parse(localStorage.getItem(A11Y_KEY) || '{}')); } catch (e) { /* sem storage */ }
  function falar(texto) {
    if (!a11y.leitor || !('speechSynthesis' in window) || !texto) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(texto).slice(0, 400)); u.lang = 'pt-BR'; speechSynthesis.speak(u);
  }
  function aplicarA11y() {
    document.documentElement.style.fontSize = (16 + a11y.fonte * 1.5) + 'px';
    document.documentElement.classList.toggle('alto-contraste', !!a11y.contraste);
    try { localStorage.setItem(A11Y_KEY, JSON.stringify(a11y)); } catch (e) { /* ignora */ }
  }
  document.addEventListener('click', e => { if (a11y.leitor && !e.target.closest('.a11y-painel')) falar(e.target.innerText || e.target.value || e.target.alt); }, true);
  aplicarA11y();

  function widgetA11y(topbar) {
    topbar.insertAdjacentHTML('beforeend',
      '<button class="a11y-btn" id="a11yBtn" aria-expanded="false">♿ Acessibilidade</button>' +
      '<div class="a11y-painel" id="a11yPainel"><div class="item"><span>🔍 <b>Tamanho da fonte</b></span><span><button class="mini" id="fMenos" aria-label="Diminuir fonte">−</button> <button class="mini" id="fMais" aria-label="Aumentar fonte">+</button></span></div>' +
      '<div class="item"><label><input type="checkbox" id="altoC"> 🌗 <b>Modo Alto Contraste</b></label></div>' +
      '<div class="item"><label><input type="checkbox" id="leitor"> 🔊 <b>Ativar Leitor de Tela</b></label></div>' +
      '<div class="rodape">Clique em qualquer texto para ouvi-lo quando o leitor estiver ativo. Conformidade WCAG 2.1.</div></div>');
    const painel = topbar.querySelector('#a11yPainel'), btn = topbar.querySelector('#a11yBtn');
    topbar.querySelector('#altoC').checked = a11y.contraste; topbar.querySelector('#leitor').checked = a11y.leitor;
    btn.onclick = e => { e.stopPropagation(); painel.classList.toggle('aberto'); btn.setAttribute('aria-expanded', painel.classList.contains('aberto')); };
    document.addEventListener('click', e => { if (!e.target.closest('#a11yPainel') && !e.target.closest('#a11yBtn')) painel.classList.remove('aberto'); });
    topbar.querySelector('#fMais').onclick = () => { a11y.fonte = Math.min(4, a11y.fonte + 1); aplicarA11y(); };
    topbar.querySelector('#fMenos').onclick = () => { a11y.fonte = Math.max(-2, a11y.fonte - 1); aplicarA11y(); };
    topbar.querySelector('#altoC').onchange = e => { a11y.contraste = e.target.checked; aplicarA11y(); };
    topbar.querySelector('#leitor').onchange = e => { a11y.leitor = e.target.checked; aplicarA11y(); if (a11y.leitor) falar('Leitor de tela ativado.'); else if ('speechSynthesis' in window) speechSynthesis.cancel(); };
  }

  // ---------- estrutura da pagina (menu lateral + topo) ----------
  const MENU = {
    ADMIN:        [['marketplace', '/marketplace', '🔎', 'Marketplace'], ['contrato', '/contrato', '📄', 'Contratos'], ['compliance', '/compliance', '👥', 'Compliance'], ['analise', '/analise', '✅', 'Análise de Documentos'], ['obrigatoriedade', '/obrigatoriedade', '⚙️', 'Obrigatoriedade'], ['financeiro', '/financeiro', '💲', 'Financeiro'], ['portaria', '/portaria', '🛡️', 'Portaria']],
    TERCEIRIZADA: [['compliance', '/compliance', '👥', 'Compliance'], ['financeiro', '/financeiro', '💲', 'Financeiro'], ['contrato', '/contrato', '📄', 'Contratos']],
    PORTARIA:     [['portaria', '/portaria', '🛡️', 'Portaria']]
  };
  const NOME_PERFIL = { ADMIN: 'Administrador', TERCEIRIZADA: 'Terceirizada', PORTARIA: 'Portaria' };

  async function iniciar(ativo) {
    const eu = await api('/api/me');
    CONECTA.eu = eu;
    const conteudo = document.getElementById('conteudo');
    const layout = document.createElement('div'); layout.className = 'layout';
    layout.innerHTML =
      '<aside class="sidebar"><div class="marca"><div class="logo">C</div><div><b>CONECTA</b><small>Sistema B2B</small></div></div><nav aria-label="Menu principal">' +
      (MENU[eu.perfil] || []).map(m => '<a href="' + m[1] + '" class="' + (m[0] === ativo ? 'ativo' : '') + '"><span>' + m[2] + '</span>' + m[3] + '</a>').join('') +
      '</nav><div class="usuario"><div class="avatar">' + esc(iniciais(eu.nome)) + '</div><div><b>' + esc(eu.nome) + '</b><small>' + esc(NOME_PERFIL[eu.perfil] || eu.perfil) + '</small></div><button id="sair">Sair</button></div></aside>' +
      '<div class="conteudo-wrap"><header class="topbar"></header></div>';
    conteudo.parentNode.insertBefore(layout, conteudo);
    layout.querySelector('.conteudo-wrap').appendChild(conteudo);
    widgetA11y(layout.querySelector('.topbar'));
    layout.querySelector('#sair').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; };
    return eu;
  }

  window.CONECTA = { api, esc, brl, dataBR, iniciais, cnpjF, cpfF, toast, dropzone, formModal, iniciar, eu: null };
})();
