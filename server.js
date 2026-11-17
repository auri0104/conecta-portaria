// CONECTA - sistema B2B (Node + Express + MySQL)
// Telas: Login, Marketplace, Perfil da Empresa, Contrato, Compliance, Financeiro e Portaria.
const express = require('express');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// >>> AJUSTE AQUI com os dados do seu MySQL (os mesmos do Workbench) <<<
const DB = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'SUA_SENHA',   // senha do root do MySQL
  database: 'conecta'
};

// dateStrings: datas chegam como 'AAAA-MM-DD' (sem problema de fuso); decimalNumbers: DECIMAL vira numero
const pool = mysql.createPool({ ...DB, waitForConnections: true, connectionLimit: 5, dateStrings: true, decimalNumbers: true });
const app = express();
app.use(express.json({ limit: '15mb' }));

const PASTA_UPLOADS = path.join(__dirname, 'uploads');
fs.mkdirSync(PASTA_UPLOADS, { recursive: true });

// ---------------------------------------------------------------- utilitarios
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ erro: err.message });
});
const ehData = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const soDigitos = s => String(s || '').replace(/\D/g, '');

function salvarArquivo(arq) {            // recebe {nome, base64}; devolve caminho salvo ou null
  if (!arq || !arq.base64) return null;
  const buf = Buffer.from(arq.base64, 'base64');
  if (buf.length === 0 || buf.length > 10 * 1024 * 1024) throw erro('Arquivo inválido ou maior que 10 MB.');
  if (buf.slice(0, 4).toString() !== '%PDF') throw erro('Envie um arquivo PDF.');
  const nome = crypto.randomBytes(12).toString('hex') + '.pdf';
  fs.writeFileSync(path.join(PASTA_UPLOADS, nome), buf);
  return 'arquivos/' + nome;
}

// ---------------------------------------------------------------- senha e sessao
function confereSenha(senha, guardado) {            // hash guardado: "scrypt$salt$hash"
  const [tipo, salt, hash] = String(guardado).split('$');
  if (tipo !== 'scrypt' || !salt || !hash) return false;
  const calc = crypto.scryptSync(senha, salt, 32);
  const esperado = Buffer.from(hash, 'hex');
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}
const sessoes = new Map();
const INICIO = { ADMIN: '/marketplace', TERCEIRIZADA: '/compliance', PORTARIA: '/portaria' };
function getSessao(req) {
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='));
  return c ? sessoes.get(c.slice(4)) || null : null;
}
function exigeApi(req, res, next) {
  const s = getSessao(req);
  if (!s) return res.status(401).json({ erro: 'Faça login novamente.' });
  req.sessao = s; next();
}
function exigePagina(req, res, next) {
  const s = getSessao(req);
  if (!s) return res.redirect('/login.html');
  req.sessao = s; next();
}
const perfis = (...ok) => (req, res, next) => {
  if (ok.includes(req.sessao.perfil)) return next();
  return req.originalUrl.startsWith('/api/')
    ? res.status(403).json({ erro: 'Sem permissão.' })
    : res.redirect(INICIO[req.sessao.perfil] || '/login.html');
};

// ---------------------------------------------------------------- paginas
app.get('/', (req, res) => {
  const s = getSessao(req);
  res.redirect(s ? INICIO[s.perfil] : '/login.html');
});
const pagina = (rota, arquivo, ...ok) =>
  app.get(rota, exigePagina, perfis(...ok), (req, res) => res.sendFile(path.join(__dirname, 'views', arquivo)));
pagina('/marketplace', 'marketplace.html', 'ADMIN');
pagina('/empresa', 'empresa.html', 'ADMIN');
pagina('/contrato', 'contrato.html', 'ADMIN', 'TERCEIRIZADA');
pagina('/compliance', 'compliance.html', 'ADMIN', 'TERCEIRIZADA');
pagina('/financeiro', 'financeiro.html', 'ADMIN', 'TERCEIRIZADA');
pagina('/portaria', 'portaria.html', 'ADMIN', 'PORTARIA');
pagina('/analise', 'analise.html', 'ADMIN');
pagina('/obrigatoriedade', 'obrigatoriedade.html', 'ADMIN');

app.get('/arquivos/:nome', exigePagina, (req, res) => {
  const p = path.join(PASTA_UPLOADS, path.basename(req.params.nome));
  if (!fs.existsSync(p)) return res.status(404).send('Arquivo não encontrado (é um registro de exemplo).');
  res.sendFile(p);
});

// ---------------------------------------------------------------- sessao / login
app.get('/api/teste-conexao', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS total_empresas FROM empresa');
    res.json({ conectado: true, banco: DB.database, total_empresas: rows[0].total_empresas });
  } catch (err) {
    res.status(500).json({ conectado: false, erro: err.message });
  }
});

app.post('/api/login', wrap(async (req, res) => {
  const { email, senha, aceite } = req.body || {};
  if (!email || !senha) throw erro('Informe e-mail e senha.');
  if (aceite !== true) throw erro('É necessário aceitar os Termos de Privacidade e LGPD.');
  const [rows] = await pool.query(
    'SELECT id_usuario, id_empresa, nome, senha_hash, perfil FROM usuario WHERE email = ? AND ativo = 1', [String(email).trim()]);
  if (rows.length === 0 || !confereSenha(String(senha), rows[0].senha_hash)) throw erro('E-mail ou senha inválidos.', 401);
  const u = rows[0];
  await pool.query('UPDATE usuario SET aceite_lgpd = 1, data_aceite_lgpd = NOW() WHERE id_usuario = ?', [u.id_usuario]);
  const token = crypto.randomBytes(24).toString('hex');
  sessoes.set(token, { id: u.id_usuario, nome: u.nome, perfil: u.perfil, idEmpresa: u.id_empresa });
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Strict`);
  res.json({ perfil: u.perfil, nome: u.nome, destino: INICIO[u.perfil] });
}));

app.post('/api/logout', (req, res) => {
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='));
  if (c) sessoes.delete(c.slice(4));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', exigeApi, (req, res) => res.json(req.sessao));

// ---------------------------------------------------------------- MARKETPLACE e PERFIL [RF010]
app.get('/api/marketplace', exigeApi, perfis('ADMIN'), wrap(async (req, res) => {
  const like = '%' + String(req.query.q || '').trim() + '%';
  const [rows] = await pool.query(
    `SELECT id_empresa, nome_fantasia, cnpj, cidade, uf, verificado, avaliacao_media, especialidades
       FROM v_marketplace
      WHERE nome_fantasia LIKE ? OR especialidades LIKE ?
      ORDER BY verificado DESC, nome_fantasia`, [like, like]);
  res.json(rows);
}));

app.get('/api/empresas/:id', exigeApi, perfis('ADMIN'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [e] = await pool.query(
    `SELECT E.id_empresa, E.razao_social, E.nome_fantasia, E.cnpj, E.cidade, E.uf, E.whatsapp, E.email_contato, E.verificado,
            (SELECT ROUND(AVG(A.nota), 1) FROM avaliacao A WHERE A.id_empresa_avaliada = E.id_empresa) AS avaliacao_media,
            (SELECT COUNT(*) FROM avaliacao A WHERE A.id_empresa_avaliada = E.id_empresa) AS total_avaliacoes,
            (SELECT COUNT(*) FROM funcionario F WHERE F.id_empresa = E.id_empresa AND F.ativo = 1) AS total_funcionarios,
            (SELECT GROUP_CONCAT(S.descricao) FROM empresa_especialidade EE
               JOIN especialidade S ON S.id_especialidade = EE.id_especialidade
              WHERE EE.id_empresa = E.id_empresa) AS especialidades
       FROM empresa E
      WHERE E.id_empresa = ? AND E.tipo = 'TERCEIRIZADA'`, [id]);
  if (e.length === 0) throw erro('Empresa não encontrada.', 404);
  const [avaliacoes] = await pool.query(
    'SELECT nota, comentario, data_avaliacao FROM avaliacao WHERE id_empresa_avaliada = ? ORDER BY data_avaliacao DESC LIMIT 5', [id]);
  const [vinculo] = await pool.query(
    'SELECT id_contrato, status, data_fim FROM contrato WHERE id_contratante = ? AND id_terceirizada = ? ORDER BY id_contrato DESC LIMIT 1',
    [req.sessao.idEmpresa, id]);
  res.json({ ...e[0], avaliacoes, vinculo: vinculo[0] || null });
}));

// ---------------------------------------------------------------- CONTRATO [RF011]
app.get('/api/contratos', exigeApi, perfis('ADMIN', 'TERCEIRIZADA'), wrap(async (req, res) => {
  const col = req.sessao.perfil === 'ADMIN' ? 'C.id_contratante' : 'C.id_terceirizada';
  const [rows] = await pool.query(
    `SELECT C.id_contrato, EC.nome_fantasia AS contratante, ET.nome_fantasia AS terceirizada,
            C.valor_prestacao, C.tipo_cobranca, C.data_inicio, C.data_fim, C.status, C.arquivo_pdf, C.data_solicitacao
       FROM contrato C
       JOIN empresa EC ON EC.id_empresa = C.id_contratante
       JOIN empresa ET ON ET.id_empresa = C.id_terceirizada
      WHERE ${col} = ?
      ORDER BY C.id_contrato DESC`, [req.sessao.idEmpresa]);
  res.json(rows);
}));

app.post('/api/contratos', exigeApi, perfis('ADMIN'), wrap(async (req, res) => {
  const b = req.body || {};
  const idTer = Number(b.id_terceirizada), valor = Number(b.valor_prestacao);
  if (!idTer) throw erro('Escolha a empresa terceirizada.');
  if (!(valor > 0)) throw erro('Informe o valor da prestação.');
  if (!['MENSAL', 'HORA'].includes(b.tipo_cobranca)) throw erro('Escolha o tipo de cobrança.');
  if (!ehData(b.data_inicio) || !ehData(b.data_fim)) throw erro('Informe as datas de vigência.');
  if (b.data_fim < b.data_inicio) throw erro('A data final não pode ser anterior à inicial.');

  const [emp] = await pool.query("SELECT id_empresa FROM empresa WHERE id_empresa = ? AND tipo = 'TERCEIRIZADA'", [idTer]);
  if (emp.length === 0) throw erro('Empresa terceirizada não encontrada.', 404);
  const [ativo] = await pool.query("SELECT id_contrato FROM contrato WHERE id_contratante = ? AND id_terceirizada = ? AND status = 'ATIVO' AND data_fim >= CURDATE()", [req.sessao.idEmpresa, idTer]);
  if (ativo.length) throw erro('Já existe um contrato ativo com esta empresa.');

  const pdf = salvarArquivo(b.arquivo);
  const status = pdf ? 'ATIVO' : 'SOLICITADO';           // com o PDF assinado o contrato fica ativo
  const [sol] = await pool.query("SELECT id_contrato FROM contrato WHERE id_contratante = ? AND id_terceirizada = ? AND status = 'SOLICITADO' LIMIT 1", [req.sessao.idEmpresa, idTer]);
  if (sol.length) {
    await pool.query('UPDATE contrato SET valor_prestacao = ?, tipo_cobranca = ?, data_inicio = ?, data_fim = ?, status = ?, arquivo_pdf = ? WHERE id_contrato = ?',
      [valor, b.tipo_cobranca, b.data_inicio, b.data_fim, status, pdf, sol[0].id_contrato]);
    return res.json({ id_contrato: sol[0].id_contrato, status });
  }
  const [r] = await pool.query(
    'INSERT INTO contrato (id_contratante, id_terceirizada, valor_prestacao, tipo_cobranca, data_inicio, data_fim, status, arquivo_pdf, data_solicitacao) VALUES (?,?,?,?,?,?,?,?,CURDATE())',
    [req.sessao.idEmpresa, idTer, valor, b.tipo_cobranca, b.data_inicio, b.data_fim, status, pdf]);
  res.json({ id_contrato: r.insertId, status });
}));

// ---------------------------------------------------------------- COMPLIANCE DE RH [RF003/RF013]
async function funcionarioDoEscopo(req, id) {
  const [r] = await pool.query('SELECT id_funcionario, id_empresa, nome, cpf, ativo FROM funcionario WHERE id_funcionario = ?', [Number(id)]);
  if (r.length === 0) throw erro('Funcionário não encontrado.', 404);
  if (req.sessao.perfil === 'TERCEIRIZADA' && r[0].id_empresa !== req.sessao.idEmpresa) throw erro('Sem permissão.', 403);
  return r[0];
}

app.get('/api/funcionarios', exigeApi, perfis('ADMIN', 'TERCEIRIZADA'), wrap(async (req, res) => {
  const like = '%' + String(req.query.q || '').trim() + '%';
  const params = [like, like];
  let escopo = '';
  if (req.sessao.perfil === 'TERCEIRIZADA') { escopo = 'AND F.id_empresa = ?'; params.push(req.sessao.idEmpresa); }
  const [rows] = await pool.query(
    `SELECT X.*, DATEDIFF(X.aso_validade, CURDATE()) AS dias_aso
       FROM (SELECT F.id_funcionario, F.nome, F.cpf, E.nome_fantasia AS empresa, P.motivo_negado,
                    (SELECT MAX(D.data_validade) FROM documento_funcionario D
                       JOIN tipo_documento T ON T.id_tipo_documento = D.id_tipo_documento
                      WHERE D.id_funcionario = F.id_funcionario AND T.codigo = 'ASO' AND D.status_analise = 'APROVADO') AS aso_validade
               FROM funcionario F
               JOIN empresa E ON E.id_empresa = F.id_empresa
               LEFT JOIN v_portaria P ON P.id_funcionario = F.id_funcionario
              WHERE F.ativo = 1 AND (F.nome LIKE ? OR F.cpf LIKE ?) ${escopo}) X
      ORDER BY X.nome`, params);
  res.json(rows);
}));

app.post('/api/funcionarios', exigeApi, perfis('ADMIN', 'TERCEIRIZADA'), wrap(async (req, res) => {
  const b = req.body || {};
  const cpf = soDigitos(b.cpf), nome = String(b.nome || '').trim();
  if (!nome) throw erro('Informe o nome.');
  if (cpf.length !== 11) throw erro('Informe um CPF com 11 dígitos.');
  const idEmpresa = req.sessao.perfil === 'TERCEIRIZADA' ? req.sessao.idEmpresa : Number(b.id_empresa);
  if (!idEmpresa) throw erro('Escolha a empresa.');
  try {
    const [r] = await pool.query('INSERT INTO funcionario (id_empresa, nome, cpf) VALUES (?,?,?)', [idEmpresa, nome, cpf]);
    res.json({ id_funcionario: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw erro('Já existe um funcionário com este CPF.', 409);
    throw err;
  }
}));

app.get('/api/funcionarios/:id', exigeApi, perfis('ADMIN', 'TERCEIRIZADA'), wrap(async (req, res) => {
  const f = await funcionarioDoEscopo(req, req.params.id);
  const idf = f.id_funcionario;
  const [empresa] = await pool.query('SELECT nome_fantasia FROM empresa WHERE id_empresa = ?', [f.id_empresa]);
  const [situacao] = await pool.query('SELECT motivo_negado FROM v_portaria WHERE id_funcionario = ?', [idf]);
  const [documentos] = await pool.query(
    `SELECT D.id_documento, T.codigo, T.descricao, D.arquivo_pdf, D.data_emissao, D.data_validade,
            D.status_analise, D.justificativa, D.data_envio,
            DATEDIFF(D.data_validade, CURDATE()) AS dias
       FROM documento_funcionario D JOIN tipo_documento T ON T.id_tipo_documento = D.id_tipo_documento
      WHERE D.id_funcionario = ? ORDER BY D.id_documento DESC`, [idf]);
  const [treinamentos] = await pool.query(
    `SELECT T.id_treinamento, T.codigo, T.descricao, T.obrigatorio, FT.data_realizacao, FT.data_validade, FT.certificado_pdf,
            DATEDIFF(FT.data_validade, CURDATE()) AS dias
       FROM treinamento_nr T
       LEFT JOIN funcionario_treinamento FT ON FT.id_treinamento = T.id_treinamento AND FT.id_funcionario = ?
      ORDER BY T.codigo`, [idf]);
  const [equipamentos] = await pool.query(
    `SELECT Q.id_equipamento, Q.descricao, Q.tipo, TR.id_termo, TR.data_entrega, TR.arquivo_pdf
       FROM equipamento Q
       LEFT JOIN termo_responsabilidade TR ON TR.id_equipamento = Q.id_equipamento AND TR.id_funcionario = ?
      WHERE Q.id_empresa = ? ORDER BY Q.tipo, Q.descricao`, [idf, f.id_empresa]);
  res.json({ ...f, empresa: empresa[0].nome_fantasia, motivo_negado: situacao.length ? situacao[0].motivo_negado : null,
             documentos, treinamentos, equipamentos });
}));

app.post('/api/funcionarios/:id/documentos', exigeApi, perfis('ADMIN', 'TERCEIRIZADA'), wrap(async (req, res) => {
  const f = await funcionarioDoEscopo(req, req.params.id);
  const b = req.body || {};
  const [t] = await pool.query('SELECT id_tipo_documento, exige_validade FROM tipo_documento WHERE codigo = ?', [String(b.codigo)]);
  if (t.length === 0) throw erro('Tipo de documento inválido.');
  if (t[0].exige_validade && !ehData(b.data_validade)) throw erro('Informe a data de validade.');
  if (b.data_emissao && !ehData(b.data_emissao)) throw erro('Data de emissão inválida.');
  const pdf = salvarArquivo(b.arquivo);
  if (!pdf) throw erro('Anexe o arquivo PDF.');
  await pool.query(
    'INSERT INTO documento_funcionario (id_funcionario, id_tipo_documento, arquivo_pdf, data_emissao, data_validade) VALUES (?,?,?,?,?)',
    [f.id_funcionario, t[0].id_tipo_documento, pdf, b.data_emissao || null, t[0].exige_validade ? b.data_validade : null]);
  res.json({ ok: true });
}));

app.post('/api/funcionarios/:id/treinamentos', exigeApi, perfis('ADMIN', 'TERCEIRIZADA'), wrap(async (req, res) => {
  const f = await funcionarioDoEscopo(req, req.params.id);
  const b = req.body || {};
  if (!ehData(b.data_realizacao)) throw erro('Informe a data de realização.');
  const [t] = await pool.query('SELECT id_treinamento FROM treinamento_nr WHERE id_treinamento = ?', [Number(b.id_treinamento)]);
  if (t.length === 0) throw erro('Treinamento inválido.');
  const pdf = salvarArquivo(b.arquivo);
  await pool.query('DELETE FROM funcionario_treinamento WHERE id_funcionario = ? AND id_treinamento = ?', [f.id_funcionario, t[0].id_treinamento]);
  await pool.query(
    `INSERT INTO funcionario_treinamento (id_funcionario, id_treinamento, data_realizacao, data_validade, certificado_pdf)
     SELECT ?, T.id_treinamento, ?, DATE_ADD(?, INTERVAL T.validade_meses MONTH), ?
       FROM treinamento_nr T WHERE T.id_treinamento = ?`,
    [f.id_funcionario, b.data_realizacao, b.data_realizacao, pdf, t[0].id_treinamento]);
  res.json({ ok: true });
}));

app.post('/api/funcionarios/:id/equipamentos', exigeApi, perfis('ADMIN', 'TERCEIRIZADA'), wrap(async (req, res) => {
  const f = await funcionarioDoEscopo(req, req.params.id);
  const b = req.body || {};
  const descricao = String(b.descricao || '').trim();
  if (!descricao) throw erro('Informe a descrição.');
  if (!['EPI', 'FERRAMENTA'].includes(b.tipo)) throw erro('Escolha o tipo.');
  await pool.query('INSERT INTO equipamento (id_empresa, descricao, tipo) VALUES (?,?,?)', [f.id_empresa, descricao, b.tipo]);
  res.json({ ok: true });
}));

app.post('/api/funcionarios/:id/termos', exigeApi, perfis('ADMIN', 'TERCEIRIZADA'), wrap(async (req, res) => {
  const f = await funcionarioDoEscopo(req, req.params.id);
  const b = req.body || {};
  if (!ehData(b.data_entrega)) throw erro('Informe a data de entrega.');
  const [q] = await pool.query('SELECT id_equipamento FROM equipamento WHERE id_equipamento = ? AND id_empresa = ?', [Number(b.id_equipamento), f.id_empresa]);
  if (q.length === 0) throw erro('Equipamento inválido.');
  const pdf = salvarArquivo(b.arquivo);
  if (!pdf) throw erro('Anexe o Termo de Responsabilidade (PDF).');
  await pool.query('DELETE FROM termo_responsabilidade WHERE id_funcionario = ? AND id_equipamento = ?', [f.id_funcionario, q[0].id_equipamento]);
  await pool.query('INSERT INTO termo_responsabilidade (id_funcionario, id_equipamento, data_entrega, arquivo_pdf) VALUES (?,?,?,?)',
    [f.id_funcionario, q[0].id_equipamento, b.data_entrega, pdf]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- ANALISE DE DOCUMENTOS [RF004 / RF005 / RF006 / RF007]
async function avisar(idEmpresa, msg) {
  await pool.query('INSERT INTO notificacao (id_empresa, mensagem) VALUES (?,?)', [idEmpresa, msg]);
}

// RF004: fila de analise (padrao = pendentes; tambem lista aprovados e reprovados)
app.get('/api/analise', exigeApi, perfis('ADMIN'), wrap(async (req, res) => {
  const st = ['PENDENTE', 'APROVADO', 'REPROVADO'].includes(req.query.status) ? req.query.status : 'PENDENTE';
  const [rows] = await pool.query(
    `SELECT D.id_documento, D.status_analise, D.justificativa, D.arquivo_pdf, D.data_emissao, D.data_validade, D.data_envio, D.data_analise,
            T.codigo, T.descricao AS tipo, F.id_funcionario, F.nome, F.cpf, E.nome_fantasia AS empresa
       FROM documento_funcionario D
       JOIN tipo_documento T ON T.id_tipo_documento = D.id_tipo_documento
       JOIN funcionario F ON F.id_funcionario = D.id_funcionario
       JOIN empresa E ON E.id_empresa = F.id_empresa
      WHERE D.status_analise = ?
      ORDER BY D.data_envio, D.id_documento`, [st]);
  const [cont] = await pool.query('SELECT status_analise, COUNT(*) AS qtd FROM documento_funcionario GROUP BY status_analise');
  const contagem = { PENDENTE: 0, APROVADO: 0, REPROVADO: 0 };
  cont.forEach(c => { contagem[c.status_analise] = Number(c.qtd); });
  res.json({ status: st, contagem, documentos: rows });
}));

async function documentoPendente(id) {
  const [r] = await pool.query(
    `SELECT D.id_documento, D.status_analise, D.id_funcionario, F.nome, F.id_empresa, T.codigo
       FROM documento_funcionario D
       JOIN funcionario F ON F.id_funcionario = D.id_funcionario
       JOIN tipo_documento T ON T.id_tipo_documento = D.id_tipo_documento
      WHERE D.id_documento = ?`, [Number(id)]);
  if (r.length === 0) throw erro('Documento não encontrado.', 404);
  if (r[0].status_analise !== 'PENDENTE') throw erro('Este documento já foi analisado.', 409);
  return r[0];
}

// RF005 (aprovar) + RF007 (o sistema reavalia o colaborador e sincroniza com a portaria)
app.post('/api/documentos/:id/aprovar', exigeApi, perfis('ADMIN'), wrap(async (req, res) => {
  const d = await documentoPendente(req.params.id);
  await pool.query("UPDATE documento_funcionario SET status_analise = 'APROVADO', justificativa = NULL, id_analista = ?, data_analise = CURRENT_TIMESTAMP WHERE id_documento = ?",
    [req.sessao.id, d.id_documento]);
  const [v] = await pool.query('SELECT motivo_negado FROM v_portaria WHERE id_funcionario = ?', [d.id_funcionario]);
  const motivo = v.length ? v[0].motivo_negado : null;
  const liberado = motivo === null;
  await avisar(d.id_empresa, liberado
    ? d.codigo + ' de ' + d.nome + ' aprovado. Colaborador LIBERADO para acesso.'
    : d.codigo + ' de ' + d.nome + ' aprovado. Colaborador ainda bloqueado: ' + motivo + '.');
  res.json({ ok: true, status_colaborador: liberado ? 'LIBERADO' : 'BLOQUEADO', motivo });
}));

// RF006 (extend de RF005): reprovar exige justificativa
app.post('/api/documentos/:id/reprovar', exigeApi, perfis('ADMIN'), wrap(async (req, res) => {
  const just = String((req.body || {}).justificativa || '').trim();
  if (just.length < 5) throw erro('Informe a justificativa da reprovação (mínimo 5 caracteres).');
  if (just.length > 200) throw erro('A justificativa pode ter no máximo 200 caracteres.');
  const d = await documentoPendente(req.params.id);
  await pool.query("UPDATE documento_funcionario SET status_analise = 'REPROVADO', justificativa = ?, id_analista = ?, data_analise = CURRENT_TIMESTAMP WHERE id_documento = ?",
    [just, req.sessao.id, d.id_documento]);
  await avisar(d.id_empresa, d.codigo + ' de ' + d.nome + ' REPROVADO: ' + just + ' Envie um novo documento.');
  res.json({ ok: true, status_colaborador: 'BLOQUEADO' });
}));

// ---------------------------------------------------------------- OBRIGATORIEDADE DE DOCUMENTOS [RF001]
app.get('/api/obrigatoriedade', exigeApi, perfis('ADMIN'), wrap(async (req, res) => {
  const [documentos] = await pool.query('SELECT id_tipo_documento AS id, codigo, descricao, obrigatorio FROM tipo_documento ORDER BY id_tipo_documento');
  const [treinamentos] = await pool.query('SELECT id_treinamento AS id, codigo, descricao, obrigatorio FROM treinamento_nr ORDER BY codigo');
  res.json({ documentos, treinamentos });
}));
app.post('/api/obrigatoriedade', exigeApi, perfis('ADMIN'), wrap(async (req, res) => {
  const b = req.body || {};
  const tabela = { DOC: ['tipo_documento', 'id_tipo_documento'], NR: ['treinamento_nr', 'id_treinamento'] }[b.tipo];
  if (!tabela) throw erro('Tipo inválido.');
  const [r] = await pool.query('UPDATE ' + tabela[0] + ' SET obrigatorio = ? WHERE ' + tabela[1] + ' = ?', [b.obrigatorio ? 1 : 0, Number(b.id)]);
  if (!r.affectedRows) throw erro('Item não encontrado.', 404);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- NOTIFICACOES (terceirizada)
app.get('/api/notificacoes', exigeApi, perfis('TERCEIRIZADA'), wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id_notificacao, mensagem, data_hora, lida FROM notificacao WHERE id_empresa = ? ORDER BY id_notificacao DESC LIMIT 20', [req.sessao.idEmpresa]);
  res.json(rows);
}));
app.post('/api/notificacoes/lidas', exigeApi, perfis('TERCEIRIZADA'), wrap(async (req, res) => {
  await pool.query('UPDATE notificacao SET lida = 1 WHERE id_empresa = ?', [req.sessao.idEmpresa]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- FINANCEIRO [RF012/RNF006]
// Uma nota fiscal = uma linha em "fatura": a terceirizada a ve como emitida e a contratante como a pagar.
app.get('/api/faturas', exigeApi, perfis('ADMIN', 'TERCEIRIZADA'), wrap(async (req, res) => {
  const col = req.sessao.perfil === 'ADMIN' ? 'C.id_contratante' : 'C.id_terceirizada';
  const params = [req.sessao.idEmpresa];
  let filtro = '';
  if (ehData(req.query.de))  { filtro += ' AND FA.data_vencimento >= ?'; params.push(req.query.de); }
  if (ehData(req.query.ate)) { filtro += ' AND FA.data_vencimento <= ?'; params.push(req.query.ate); }
  const [rows] = await pool.query(
    `SELECT FA.id_fatura, FA.numero_nf, FA.descricao_servico, FA.valor, FA.data_emissao, FA.data_vencimento, FA.data_pagamento,
            CASE WHEN FA.status = 'PENDENTE' AND FA.data_vencimento < CURDATE() THEN 'VENCIDA' ELSE FA.status END AS status,
            EC.nome_fantasia AS contratante, ET.nome_fantasia AS terceirizada
       FROM fatura FA
       JOIN contrato C  ON C.id_contrato = FA.id_contrato
       JOIN empresa EC  ON EC.id_empresa = C.id_contratante
       JOIN empresa ET  ON ET.id_empresa = C.id_terceirizada
      WHERE ${col} = ? ${filtro}
      ORDER BY FA.data_vencimento DESC, FA.id_fatura DESC`, params);
  res.json(rows);
}));

app.get('/api/faturas/contratos', exigeApi, perfis('TERCEIRIZADA'), wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT C.id_contrato, EC.nome_fantasia AS contratante, C.tipo_cobranca, C.valor_prestacao
       FROM contrato C JOIN empresa EC ON EC.id_empresa = C.id_contratante
      WHERE C.id_terceirizada = ? AND C.status = 'ATIVO' AND C.data_fim >= CURDATE()`, [req.sessao.idEmpresa]);
  res.json(rows);
}));

app.post('/api/faturas', exigeApi, perfis('TERCEIRIZADA'), wrap(async (req, res) => {   // "Emitir Nota Fiscal"
  const b = req.body || {};
  const valor = Number(b.valor), descricao = String(b.descricao_servico || '').trim();
  if (!descricao) throw erro('Descreva o serviço.');
  if (!(valor > 0)) throw erro('Informe o valor.');
  if (!ehData(b.data_vencimento)) throw erro('Informe o vencimento.');
  const [c] = await pool.query("SELECT id_contrato FROM contrato WHERE id_contrato = ? AND id_terceirizada = ? AND status = 'ATIVO'", [Number(b.id_contrato), req.sessao.idEmpresa]);
  if (c.length === 0) throw erro('Contrato inválido.');
  const [m] = await pool.query('SELECT COALESCE(MAX(id_fatura), 0) + 1 AS prox FROM fatura');
  const numero = 'NF-' + String(m[0].prox).padStart(4, '0');
  await pool.query(
    "INSERT INTO fatura (id_contrato, numero_nf, descricao_servico, valor, data_emissao, data_vencimento, status) VALUES (?,?,?,?,CURDATE(),?,'PENDENTE')",
    [c[0].id_contrato, numero, descricao, valor, b.data_vencimento]);
  res.json({ numero_nf: numero });
}));

app.post('/api/faturas/:id/pagar', exigeApi, perfis('ADMIN'), wrap(async (req, res) => {
  const [r] = await pool.query(
    `UPDATE fatura SET status = 'PAGA', data_pagamento = CURDATE()
      WHERE id_fatura = ? AND status <> 'PAGA'
        AND id_contrato IN (SELECT id_contrato FROM contrato WHERE id_contratante = ?)`,
    [Number(req.params.id), req.sessao.idEmpresa]);
  if (r.affectedRows === 0) throw erro('Fatura não encontrada ou já paga.', 404);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- PORTARIA [RF006/RNF003]
app.get('/api/portaria/:cpf', exigeApi, perfis('ADMIN', 'PORTARIA'), wrap(async (req, res) => {
  const cpf = soDigitos(req.params.cpf);
  if (cpf.length !== 11) throw erro('Informe um CPF com 11 dígitos.');
  const [rows] = await pool.query('SELECT id_funcionario, nome, empresa, motivo_negado FROM v_portaria WHERE cpf = ?', [cpf]);
  let resposta;
  if (rows.length === 0) {
    resposta = { resultado: 'ACESSO NEGADO', motivo: 'CPF não cadastrado', idFuncionario: null };
  } else {
    const f = rows[0], liberado = f.motivo_negado === null;
    resposta = { resultado: liberado ? 'LIBERADO' : 'ACESSO NEGADO', motivo: f.motivo_negado, nome: f.nome, empresa: f.empresa, idFuncionario: f.id_funcionario };
  }
  await pool.query('INSERT INTO registro_acesso (id_usuario, id_funcionario, cpf_consultado, resultado, motivo) VALUES (?,?,?,?,?)',
    [req.sessao.id, resposta.idFuncionario, cpf, resposta.resultado, resposta.motivo]);
  res.json(resposta);
}));

app.use(express.static(path.join(__dirname, 'public')));   // login.html, app.css, app.js

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => console.log('CONECTA rodando em http://localhost:' + PORTA));
