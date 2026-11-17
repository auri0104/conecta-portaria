-- =====================================================================
-- CONECTA - Gestao de Parceiros (sistema B2B)
-- Banco de dados MySQL 8 - modelo derivado do prototipo (6 telas + login)
--
-- Requisitos cobertos:
--   Login (3 perfis + aceite LGPD)  -> usuario
--   Marketplace / Perfil [RF010]    -> empresa, especialidade, avaliacao
--   Vinculo e Contrato [RF011]      -> contrato
--   Compliance de RH [RF003/RF013]  -> funcionario, documento_funcionario,
--                                      treinamento_nr, funcionario_treinamento,
--                                      equipamento, termo_responsabilidade
--   Financeiro [RF012/RNF006]       -> fatura (UMA tabela, vista pelas duas
--                                      pontas: emitida pela terceirizada e
--                                      a pagar da contratante = sincronizado)
--   Portaria [RF006/RNF003]         -> v_portaria, registro_acesso
-- =====================================================================
DROP DATABASE IF EXISTS conecta;
CREATE DATABASE conecta CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE conecta;

-- ---------------------------------------------------------------------
-- EMPRESAS (contratante e terceirizadas na mesma tabela)
-- ---------------------------------------------------------------------
CREATE TABLE empresa (
    id_empresa     INT AUTO_INCREMENT PRIMARY KEY,
    tipo           VARCHAR(15)  NOT NULL CHECK (tipo IN ('CONTRATANTE','TERCEIRIZADA')),
    cnpj           CHAR(14)     NOT NULL UNIQUE,
    razao_social   VARCHAR(120) NOT NULL,
    nome_fantasia  VARCHAR(80)  NOT NULL,
    cidade         VARCHAR(60),
    uf             CHAR(2),
    whatsapp       VARCHAR(15),
    email_contato  VARCHAR(100),
    verificado     BOOLEAN      NOT NULL DEFAULT 0,   -- selo "Verificado"
    ativo          BOOLEAN      NOT NULL DEFAULT 1
);

CREATE TABLE especialidade (
    id_especialidade INT AUTO_INCREMENT PRIMARY KEY,
    descricao        VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE empresa_especialidade (
    id_empresa       INT NOT NULL,
    id_especialidade INT NOT NULL,
    PRIMARY KEY (id_empresa, id_especialidade),
    FOREIGN KEY (id_empresa)       REFERENCES empresa(id_empresa),
    FOREIGN KEY (id_especialidade) REFERENCES especialidade(id_especialidade)
);

CREATE TABLE avaliacao (
    id_avaliacao          INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa_avaliada   INT NOT NULL,
    id_empresa_avaliadora INT NOT NULL,
    nota                  INT NOT NULL CHECK (nota BETWEEN 1 AND 5),
    comentario            VARCHAR(255),
    data_avaliacao        DATE NOT NULL,
    FOREIGN KEY (id_empresa_avaliada)   REFERENCES empresa(id_empresa),
    FOREIGN KEY (id_empresa_avaliadora) REFERENCES empresa(id_empresa)
);

-- ---------------------------------------------------------------------
-- USUARIOS (login: ADMIN, TERCEIRIZADA, PORTARIA)
-- ---------------------------------------------------------------------
CREATE TABLE usuario (
    id_usuario       INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa       INT NOT NULL,
    nome             VARCHAR(100) NOT NULL,
    email            VARCHAR(100) NOT NULL UNIQUE,
    senha_hash       VARCHAR(200) NOT NULL,            -- hash scrypt (salt$hash), nunca a senha
    perfil           VARCHAR(15)  NOT NULL CHECK (perfil IN ('ADMIN','TERCEIRIZADA','PORTARIA')),
    aceite_lgpd      BOOLEAN      NOT NULL DEFAULT 0,
    data_aceite_lgpd DATETIME,
    ativo            BOOLEAN      NOT NULL DEFAULT 1,
    FOREIGN KEY (id_empresa) REFERENCES empresa(id_empresa)
);

-- ---------------------------------------------------------------------
-- VINCULO / CONTRATO DIGITAL [RF011]
-- "Solicitar Vinculo" cria o contrato com status SOLICITADO;
-- depois de assinado (PDF anexado) passa para ATIVO.
-- ---------------------------------------------------------------------
CREATE TABLE contrato (
    id_contrato      INT AUTO_INCREMENT PRIMARY KEY,
    id_contratante   INT NOT NULL,
    id_terceirizada  INT NOT NULL,
    valor_prestacao  DECIMAL(12,2),
    tipo_cobranca    VARCHAR(10) CHECK (tipo_cobranca IN ('MENSAL','HORA')),
    data_inicio      DATE,
    data_fim         DATE,
    status           VARCHAR(15) NOT NULL DEFAULT 'SOLICITADO'
                     CHECK (status IN ('SOLICITADO','ATIVO','ENCERRADO','CANCELADO')),
    arquivo_pdf      VARCHAR(255),                     -- caminho do contrato assinado
    data_solicitacao DATE NOT NULL,
    FOREIGN KEY (id_contratante)  REFERENCES empresa(id_empresa),
    FOREIGN KEY (id_terceirizada) REFERENCES empresa(id_empresa)
);

-- ---------------------------------------------------------------------
-- COMPLIANCE DE RH [RF003/RF013]
-- ---------------------------------------------------------------------
CREATE TABLE funcionario (
    id_funcionario INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa     INT NOT NULL,                       -- terceirizada empregadora
    nome           VARCHAR(100) NOT NULL,
    cpf            CHAR(11)     NOT NULL UNIQUE,
    foto_url       VARCHAR(255),
    ativo          BOOLEAN      NOT NULL DEFAULT 1,
    FOREIGN KEY (id_empresa) REFERENCES empresa(id_empresa)
);

CREATE TABLE tipo_documento (
    id_tipo_documento INT AUTO_INCREMENT PRIMARY KEY,
    codigo            VARCHAR(20) NOT NULL UNIQUE,     -- ASO, FICHA_REGISTRO
    descricao         VARCHAR(80) NOT NULL,
    exige_validade    BOOLEAN     NOT NULL DEFAULT 0,
    obrigatorio       BOOLEAN     NOT NULL DEFAULT 1   -- RF001: configurado pelo Administrador
);

CREATE TABLE documento_funcionario (
    id_documento      INT AUTO_INCREMENT PRIMARY KEY,
    id_funcionario    INT NOT NULL,
    id_tipo_documento INT NOT NULL,
    arquivo_pdf       VARCHAR(255),
    data_emissao      DATE,
    data_validade     DATE,                            -- ASO: contador de dias para vencer
    data_envio        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- RF004/RF005/RF006: analise feita pelo Administrador
    status_analise    VARCHAR(10) NOT NULL DEFAULT 'PENDENTE'
                      CHECK (status_analise IN ('PENDENTE','APROVADO','REPROVADO')),
    justificativa     VARCHAR(200),                    -- obrigatoria quando REPROVADO
    id_analista       INT,
    data_analise      DATETIME,
    FOREIGN KEY (id_funcionario)    REFERENCES funcionario(id_funcionario),
    FOREIGN KEY (id_tipo_documento) REFERENCES tipo_documento(id_tipo_documento),
    FOREIGN KEY (id_analista)       REFERENCES usuario(id_usuario)
);

-- Avisos para a empresa terceirizada (ex.: documento reprovado, colaborador liberado)
CREATE TABLE notificacao (
    id_notificacao INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa     INT NOT NULL,
    mensagem       VARCHAR(255) NOT NULL,
    data_hora      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lida           BOOLEAN  NOT NULL DEFAULT 0,
    FOREIGN KEY (id_empresa) REFERENCES empresa(id_empresa)
);

CREATE TABLE treinamento_nr (
    id_treinamento INT AUTO_INCREMENT PRIMARY KEY,
    codigo         VARCHAR(10) NOT NULL UNIQUE,        -- NR-35, NR-10 ...
    descricao      VARCHAR(80) NOT NULL,
    validade_meses INT         NOT NULL,
    obrigatorio    BOOLEAN     NOT NULL DEFAULT 0      -- exigido na portaria
);

CREATE TABLE funcionario_treinamento (
    id_func_trein   INT AUTO_INCREMENT PRIMARY KEY,
    id_funcionario  INT NOT NULL,
    id_treinamento  INT NOT NULL,
    data_realizacao DATE NOT NULL,
    data_validade   DATE NOT NULL,
    certificado_pdf VARCHAR(255),
    UNIQUE (id_funcionario, id_treinamento),
    FOREIGN KEY (id_funcionario) REFERENCES funcionario(id_funcionario),
    FOREIGN KEY (id_treinamento) REFERENCES treinamento_nr(id_treinamento)
);

-- Gestao de ativos: EPIs e ferramentas + termo de responsabilidade
CREATE TABLE equipamento (
    id_equipamento INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa     INT NOT NULL,
    descricao      VARCHAR(80) NOT NULL,
    tipo           VARCHAR(10) NOT NULL CHECK (tipo IN ('EPI','FERRAMENTA')),
    FOREIGN KEY (id_empresa) REFERENCES empresa(id_empresa)
);

CREATE TABLE termo_responsabilidade (
    id_termo       INT AUTO_INCREMENT PRIMARY KEY,
    id_funcionario INT NOT NULL,
    id_equipamento INT NOT NULL,
    data_entrega   DATE NOT NULL,
    arquivo_pdf    VARCHAR(255),
    FOREIGN KEY (id_funcionario) REFERENCES funcionario(id_funcionario),
    FOREIGN KEY (id_equipamento) REFERENCES equipamento(id_equipamento)
);

-- ---------------------------------------------------------------------
-- FINANCEIRO [RF012/RNF006]
-- Uma nota fiscal = uma linha. A terceirizada a ve como "fatura emitida"
-- e a contratante como "conta a pagar": nao ha duplicacao, entao o painel
-- fica sincronizado por construcao.
-- ---------------------------------------------------------------------
CREATE TABLE fatura (
    id_fatura        INT AUTO_INCREMENT PRIMARY KEY,
    id_contrato      INT NOT NULL,
    numero_nf        VARCHAR(20)  NOT NULL UNIQUE,
    descricao_servico VARCHAR(120) NOT NULL,
    valor            DECIMAL(12,2) NOT NULL,
    data_emissao     DATE NOT NULL,
    data_vencimento  DATE NOT NULL,
    data_pagamento   DATE,
    status           VARCHAR(10) NOT NULL DEFAULT 'PENDENTE'
                     CHECK (status IN ('PENDENTE','PAGA','VENCIDA')),
    FOREIGN KEY (id_contrato) REFERENCES contrato(id_contrato)
);

-- ---------------------------------------------------------------------
-- PORTARIA [RF006/RNF003] - historico de consultas
-- ---------------------------------------------------------------------
CREATE TABLE registro_acesso (
    id_registro    INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario     INT NOT NULL,                       -- porteiro que consultou
    id_funcionario INT,                                -- NULL se o CPF nao existe
    cpf_consultado CHAR(11) NOT NULL,
    data_hora      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resultado      VARCHAR(15) NOT NULL CHECK (resultado IN ('LIBERADO','ACESSO NEGADO')),
    motivo         VARCHAR(150),
    FOREIGN KEY (id_usuario)     REFERENCES usuario(id_usuario),
    FOREIGN KEY (id_funcionario) REFERENCES funcionario(id_funcionario)
);

-- Indices para as buscas mais frequentes
CREATE INDEX idx_doc_func     ON documento_funcionario (id_funcionario, id_tipo_documento);
CREATE INDEX idx_doc_status   ON documento_funcionario (status_analise);
CREATE INDEX idx_notif_emp    ON notificacao (id_empresa, lida);
CREATE INDEX idx_func_empresa ON funcionario (id_empresa);
CREATE INDEX idx_contrato_ter ON contrato (id_terceirizada, status);
CREATE INDEX idx_fatura_contr ON fatura (id_contrato, status);
CREATE INDEX idx_acesso_data  ON registro_acesso (data_hora);


-- =====================================================================
-- VIEWS
-- =====================================================================

-- Marketplace: card da empresa com media das avaliacoes e especialidades
DROP VIEW IF EXISTS v_marketplace;
CREATE VIEW v_marketplace AS
SELECT E.id_empresa,
       E.nome_fantasia,
       E.cnpj,
       E.cidade,
       E.uf,
       E.verificado,
       ROUND((SELECT AVG(A.nota) FROM avaliacao A
               WHERE A.id_empresa_avaliada = E.id_empresa), 1) AS avaliacao_media,
       (SELECT GROUP_CONCAT(S.descricao)
          FROM empresa_especialidade EE
          JOIN especialidade S ON S.id_especialidade = EE.id_especialidade
         WHERE EE.id_empresa = E.id_empresa)                   AS especialidades
  FROM empresa E
 WHERE E.tipo = 'TERCEIRIZADA' AND E.ativo = 1;

-- Portaria: situacao de cada funcionario (motivo_negado NULL = liberado)  [RF007]
-- O status e recalculado a cada consulta: so conta documento APROVADO pelo Administrador
-- e dentro da validade, para todos os tipos marcados como obrigatorios (RF001).
DROP VIEW IF EXISTS v_portaria;
CREATE VIEW v_portaria AS
SELECT S2.id_funcionario,
       S2.cpf,
       S2.nome,
       S2.empresa,
       S2.foto_url,
       CASE
         WHEN S2.ativo = 0            THEN 'Funcionario inativo'
         WHEN S2.contratos_ativos = 0 THEN 'Empresa sem contrato vigente'
         WHEN S2.doc_pend IS NOT NULL THEN
              CASE
                WHEN S2.ult_status IS NULL         THEN CONCAT(S2.doc_pend, ' nao cadastrado')
                WHEN S2.ult_status = 'PENDENTE'    THEN CONCAT(S2.doc_pend, ' pendente de analise')
                WHEN S2.ult_status = 'REPROVADO'   THEN CONCAT(S2.doc_pend, ' reprovado: ', COALESCE(S2.ult_just, 'sem justificativa'))
                ELSE CONCAT(S2.doc_pend, ' vencido ha ', DATEDIFF(CURDATE(), S2.ult_validade), ' dias')
              END
         WHEN S2.trein_pendente IS NOT NULL
              THEN CONCAT('Treinamento ', S2.trein_pendente, ' nao realizado ou vencido')
         ELSE NULL
       END AS motivo_negado
  FROM (SELECT S1.*,
               (SELECT D.status_analise FROM documento_funcionario D
                  JOIN tipo_documento T ON T.id_tipo_documento = D.id_tipo_documento
                 WHERE D.id_funcionario = S1.id_funcionario AND T.codigo = S1.doc_pend
                 ORDER BY D.id_documento DESC LIMIT 1) AS ult_status,
               (SELECT D.justificativa FROM documento_funcionario D
                  JOIN tipo_documento T ON T.id_tipo_documento = D.id_tipo_documento
                 WHERE D.id_funcionario = S1.id_funcionario AND T.codigo = S1.doc_pend
                 ORDER BY D.id_documento DESC LIMIT 1) AS ult_just,
               (SELECT D.data_validade FROM documento_funcionario D
                  JOIN tipo_documento T ON T.id_tipo_documento = D.id_tipo_documento
                 WHERE D.id_funcionario = S1.id_funcionario AND T.codigo = S1.doc_pend
                 ORDER BY D.id_documento DESC LIMIT 1) AS ult_validade
          FROM (SELECT F.id_funcionario, F.cpf, F.nome, F.ativo, F.foto_url,
                       E.nome_fantasia AS empresa,
                       (SELECT COUNT(*) FROM contrato C
                         WHERE C.id_terceirizada = F.id_empresa
                           AND C.status = 'ATIVO'
                           AND CURDATE() BETWEEN C.data_inicio AND C.data_fim) AS contratos_ativos,
                       (SELECT MIN(T.codigo)
                          FROM tipo_documento T
                         WHERE T.obrigatorio = 1
                           AND NOT EXISTS (SELECT 1 FROM documento_funcionario D
                                            WHERE D.id_funcionario = F.id_funcionario
                                              AND D.id_tipo_documento = T.id_tipo_documento
                                              AND D.status_analise = 'APROVADO'
                                              AND (T.exige_validade = 0 OR D.data_validade >= CURDATE()))) AS doc_pend,
                       (SELECT MIN(TN.codigo)
                          FROM treinamento_nr TN
                         WHERE TN.obrigatorio = 1
                           AND NOT EXISTS (SELECT 1 FROM funcionario_treinamento FT
                                            WHERE FT.id_funcionario = F.id_funcionario
                                              AND FT.id_treinamento = TN.id_treinamento
                                              AND FT.data_validade >= CURDATE())) AS trein_pendente
                  FROM funcionario F
                  JOIN empresa E ON E.id_empresa = F.id_empresa) S1) S2;


-- =====================================================================
-- DADOS DE EXEMPLO (os mesmos do prototipo)
-- =====================================================================
INSERT INTO empresa (id_empresa, tipo, cnpj, razao_social, nome_fantasia, cidade, uf, whatsapp, email_contato, verificado) VALUES
(1, 'CONTRATANTE',  '99888777000166', 'Contratante Demo S.A.',          'Contratante Demo',   'Cascavel',       'PR', '45999990000', 'contato@contratante.demo', 1),
(2, 'TERCEIRIZADA', '12345678000190', 'Eletrica Silva & Cia Ltda',      'Eletrica Silva & Cia','Sao Paulo',     'SP', '11999990001', 'contato@eletricasilva.demo', 1),
(3, 'TERCEIRIZADA', '23456789000112', 'Pinturas Express Ltda',          'Pinturas Express',   'Rio de Janeiro', 'RJ', '21999990002', 'contato@pinturasexpress.demo', 1),
(4, 'TERCEIRIZADA', '34567890000134', 'Gesso Total Solutions Ltda',     'Gesso Total',        'Belo Horizonte', 'MG', '31999990003', 'contato@gessototal.demo', 1),
(5, 'TERCEIRIZADA', '45678901000156', 'Construtech Engenharia Ltda',    'Construtech',        'Curitiba',       'PR', '41999990004', 'contato@construtech.demo', 0),
(6, 'TERCEIRIZADA', '56789012000178', 'Hidraulica Premium Ltda',        'Hidraulica Premium', 'Porto Alegre',   'RS', '51999990005', 'contato@hidraulicapremium.demo', 1),
(7, 'TERCEIRIZADA', '67890123000190', 'Ar Condicionado Pro Ltda',       'Ar Condicionado Pro','Brasilia',       'DF', '61999990006', 'contato@arcondicionadopro.demo', 1);

INSERT INTO especialidade (id_especialidade, descricao) VALUES
(1,'Eletrica'),(2,'Automacao'),(3,'Manutencao'),(4,'Pintura'),(5,'Reforma'),(6,'Acabamento'),
(7,'Gesso'),(8,'Drywall'),(9,'Forros'),(10,'Construcao Civil'),(11,'Engenharia'),(12,'Projetos'),
(13,'Hidraulica'),(14,'Encanamento'),(15,'Saneamento'),(16,'Climatizacao'),(17,'Refrigeracao'),(18,'HVAC');

INSERT INTO empresa_especialidade (id_empresa, id_especialidade) VALUES
(2,1),(2,2),(2,3),(3,4),(3,5),(3,6),(4,7),(4,8),(4,9),
(5,10),(5,11),(5,12),(6,13),(6,14),(6,15),(7,16),(7,17),(7,18);

INSERT INTO avaliacao (id_empresa_avaliada, id_empresa_avaliadora, nota, comentario, data_avaliacao) VALUES
(2,1,5,'Equipe pontual e documentacao em dia', '2026-09-10'),
(2,1,5,'Servico dentro do prazo',              '2026-10-05'),
(2,1,4,'Bom atendimento',                      '2026-10-20'),
(3,1,5,'Acabamento excelente',                 '2026-09-18'),
(3,1,5,'Recomendo',                            '2026-10-02'),
(4,1,5,'Entrega rapida',                       '2026-08-30'),
(4,1,4,'Boa qualidade',                        '2026-10-11'),
(5,1,4,'Atendeu o escopo',                     '2026-09-25'),
(6,1,5,'Muito organizados',                    '2026-10-14'),
(7,1,4,'Servico correto',                      '2026-10-22');

-- Senha de demonstracao dos 3 usuarios: conecta123 (guardada como hash scrypt)
INSERT INTO usuario (id_usuario, id_empresa, nome, email, senha_hash, perfil, aceite_lgpd, data_aceite_lgpd) VALUES
(1, 1, 'Admin',         'admin@conecta.com',         'scrypt$a338d8e2784b1241$6978c201dcdf248d7b91227603a2a4527916d73ecaa0cc3e84bb7c4c399ec923', 'ADMIN',        1, CURRENT_TIMESTAMP),
(2, 2, 'Eletrica Silva','terceirizada@conecta.com',  'scrypt$6a6e8123875e2a8d$61b85257f9be10926373b83255fb6b672de26404c2d718271172bd4d844280e2', 'TERCEIRIZADA', 1, CURRENT_TIMESTAMP),
(3, 1, 'Portaria',      'portaria@conecta.com',      'scrypt$ed9b794787e78a35$b30fab61c0b3592704590567d6978cb8a5e903dc7d6aef8797c6a5afbd8f6b0d', 'PORTARIA',     1, CURRENT_TIMESTAMP);

INSERT INTO contrato (id_contrato, id_contratante, id_terceirizada, valor_prestacao, tipo_cobranca, data_inicio, data_fim, status, arquivo_pdf, data_solicitacao) VALUES
(1, 1, 2, 12000.00, 'MENSAL', DATE_ADD(CURDATE(), INTERVAL -100 DAY), DATE_ADD(CURDATE(), INTERVAL 265 DAY), 'ATIVO', 'contratos/contrato_1.pdf', DATE_ADD(CURDATE(), INTERVAL -110 DAY)),
(2, 1, 3,    85.00, 'HORA',   DATE_ADD(CURDATE(), INTERVAL -60 DAY),  DATE_ADD(CURDATE(), INTERVAL 305 DAY), 'ATIVO', 'contratos/contrato_2.pdf', DATE_ADD(CURDATE(), INTERVAL -70 DAY)),
(3, 1, 4,  NULL,    NULL,     NULL, NULL, 'SOLICITADO', NULL, DATE_ADD(CURDATE(), INTERVAL -2 DAY));

INSERT INTO funcionario (id_funcionario, id_empresa, nome, cpf, foto_url) VALUES
(1, 2, 'Joao Pereira', '11111111111', 'fotos/joao.jpg'),
(2, 2, 'Maria Souza',  '22222222222', 'fotos/maria.jpg'),
(3, 2, 'Carlos Lima',  '33333333333', 'fotos/carlos.jpg'),
(4, 3, 'Ana Costa',    '44444444444', 'fotos/ana.jpg'),
(5, 4, 'Pedro Alves',  '55555555555', 'fotos/pedro.jpg'),
(6, 2, 'Paulo Mendes', '66666666666', 'fotos/paulo.jpg');

INSERT INTO tipo_documento (id_tipo_documento, codigo, descricao, exige_validade, obrigatorio) VALUES
(1, 'ASO',            'Atestado de Saude Ocupacional', 1, 1),
(2, 'FICHA_REGISTRO', 'Ficha de Registro',             0, 0);

INSERT INTO documento_funcionario (id_funcionario, id_tipo_documento, arquivo_pdf, data_emissao, data_validade, status_analise, id_analista, data_analise) VALUES
(1, 1, 'docs/aso_1.pdf', DATE_ADD(CURDATE(), INTERVAL -345 DAY), DATE_ADD(CURDATE(), INTERVAL 20 DAY), 'APROVADO', 1, CURRENT_TIMESTAMP),
(2, 1, 'docs/aso_2.pdf', DATE_ADD(CURDATE(), INTERVAL -368 DAY), DATE_ADD(CURDATE(), INTERVAL -3 DAY), 'APROVADO', 1, CURRENT_TIMESTAMP),
(3, 1, 'docs/aso_3.pdf', DATE_ADD(CURDATE(), INTERVAL -100 DAY), DATE_ADD(CURDATE(), INTERVAL 265 DAY), 'APROVADO', 1, CURRENT_TIMESTAMP),
(4, 1, 'docs/aso_4.pdf', DATE_ADD(CURDATE(), INTERVAL -30 DAY),  DATE_ADD(CURDATE(), INTERVAL 335 DAY), 'APROVADO', 1, CURRENT_TIMESTAMP),
(5, 1, 'docs/aso_5.pdf', DATE_ADD(CURDATE(), INTERVAL -30 DAY),  DATE_ADD(CURDATE(), INTERVAL 335 DAY), 'APROVADO', 1, CURRENT_TIMESTAMP);

INSERT INTO documento_funcionario (id_funcionario, id_tipo_documento, arquivo_pdf, data_emissao, status_analise, id_analista, data_analise) VALUES
(1, 2, 'docs/ficha_1.pdf', '2024-03-01', 'APROVADO', 1, CURRENT_TIMESTAMP),
(2, 2, 'docs/ficha_2.pdf', '2023-07-15', 'APROVADO', 1, CURRENT_TIMESTAMP);

-- Documentos enviados e ainda NA FILA DE ANALISE do Administrador (demonstracao de RF004-RF007)
INSERT INTO documento_funcionario (id_funcionario, id_tipo_documento, arquivo_pdf, data_emissao, data_validade) VALUES
(6, 1, 'docs/aso_6.pdf',  DATE_ADD(CURDATE(), INTERVAL -2 DAY), DATE_ADD(CURDATE(), INTERVAL 363 DAY));
INSERT INTO documento_funcionario (id_funcionario, id_tipo_documento, arquivo_pdf, data_emissao) VALUES
(4, 2, 'docs/ficha_4.pdf', '2026-10-20');

INSERT INTO treinamento_nr (id_treinamento, codigo, descricao, validade_meses, obrigatorio) VALUES
(1, 'NR-35', 'Trabalho em Altura',               24, 1),
(2, 'NR-10', 'Seguranca em Instalacoes Eletricas', 24, 0),
(3, 'NR-06', 'Equipamento de Protecao Individual', 12, 0);

INSERT INTO funcionario_treinamento (id_funcionario, id_treinamento, data_realizacao, data_validade, certificado_pdf) VALUES
(1, 1, DATE_ADD(CURDATE(), INTERVAL -60 DAY),  DATE_ADD(CURDATE(), INTERVAL 670 DAY), 'certs/j_nr35.pdf'),
(1, 2, DATE_ADD(CURDATE(), INTERVAL -60 DAY),  DATE_ADD(CURDATE(), INTERVAL 670 DAY), 'certs/j_nr10.pdf'),
(2, 1, DATE_ADD(CURDATE(), INTERVAL -200 DAY), DATE_ADD(CURDATE(), INTERVAL 530 DAY), 'certs/m_nr35.pdf'),
(3, 2, DATE_ADD(CURDATE(), INTERVAL -90 DAY),  DATE_ADD(CURDATE(), INTERVAL 640 DAY), 'certs/c_nr10.pdf'),   -- Carlos: sem NR-35
(4, 1, DATE_ADD(CURDATE(), INTERVAL -30 DAY),  DATE_ADD(CURDATE(), INTERVAL 700 DAY), 'certs/a_nr35.pdf'),
(5, 1, DATE_ADD(CURDATE(), INTERVAL -30 DAY),  DATE_ADD(CURDATE(), INTERVAL 700 DAY), 'certs/p_nr35.pdf'),
(6, 1, DATE_ADD(CURDATE(), INTERVAL -40 DAY),  DATE_ADD(CURDATE(), INTERVAL 690 DAY), 'certs/pm_nr35.pdf');

INSERT INTO equipamento (id_equipamento, id_empresa, descricao, tipo) VALUES
(1, 2, 'Capacete de seguranca', 'EPI'),
(2, 2, 'Luva isolante',         'EPI'),
(3, 2, 'Alicate multimetro',    'FERRAMENTA');

INSERT INTO termo_responsabilidade (id_funcionario, id_equipamento, data_entrega, arquivo_pdf) VALUES
(1, 1, DATE_ADD(CURDATE(), INTERVAL -60 DAY), 'termos/termo_1.pdf'),
(1, 3, DATE_ADD(CURDATE(), INTERVAL -60 DAY), 'termos/termo_2.pdf');

INSERT INTO fatura (id_contrato, numero_nf, descricao_servico, valor, data_emissao, data_vencimento, data_pagamento, status) VALUES
(1, 'NF-0001', 'Manutencao eletrica - mes anterior', 12000.00, DATE_ADD(CURDATE(), INTERVAL -40 DAY), DATE_ADD(CURDATE(), INTERVAL -10 DAY), DATE_ADD(CURDATE(), INTERVAL -12 DAY), 'PAGA'),
(1, 'NF-0002', 'Manutencao eletrica - mes atual',    12000.00, DATE_ADD(CURDATE(), INTERVAL -5 DAY),  DATE_ADD(CURDATE(), INTERVAL 25 DAY),  NULL, 'PENDENTE'),
(2, 'NF-0003', 'Pintura bloco B (80 horas)',          6800.00, DATE_ADD(CURDATE(), INTERVAL -50 DAY), DATE_ADD(CURDATE(), INTERVAL -20 DAY), NULL, 'VENCIDA');


-- =====================================================================
-- CONSULTAS DE TESTE (uso nas telas)
-- =====================================================================

-- 1) Teste de conexao simples
SELECT COUNT(*) AS total_empresas FROM empresa;

-- 2) Marketplace (busca por especialidade; troque 'Eletrica' pelo termo digitado)
SELECT nome_fantasia, cidade, uf, verificado, avaliacao_media, especialidades
  FROM v_marketplace
 WHERE especialidades LIKE '%Eletrica%';

-- 3) Portaria: digitar o CPF -> LIBERADO ou ACESSO NEGADO (+ motivo)
SELECT nome, empresa,
       CASE WHEN motivo_negado IS NULL THEN 'LIBERADO' ELSE 'ACESSO NEGADO' END AS resultado,
       motivo_negado
  FROM v_portaria
 WHERE cpf = '22222222222';

-- 4) Portal da terceirizada: funcionarios e dias para o ASO vencer
SELECT F.nome, F.cpf, D.data_validade AS aso_validade,
       DATEDIFF(D.data_validade, CURDATE()) AS dias_para_vencer
  FROM funcionario F
  LEFT JOIN documento_funcionario D ON D.id_funcionario = F.id_funcionario
       AND D.id_tipo_documento = 1
 WHERE F.id_empresa = 2;

-- 5) Painel financeiro - visao da TERCEIRIZADA (faturas emitidas)
SELECT FA.numero_nf, FA.descricao_servico, FA.valor, FA.data_vencimento, FA.status
  FROM fatura FA
  JOIN contrato C ON C.id_contrato = FA.id_contrato
 WHERE C.id_terceirizada = 2;

-- 6) Painel financeiro - visao da CONTRATANTE (contas a pagar) - mesma tabela
SELECT E.nome_fantasia AS empresa_parceira, FA.descricao_servico, FA.valor,
       FA.data_vencimento, FA.status
  FROM fatura FA
  JOIN contrato C ON C.id_contrato = FA.id_contrato
  JOIN empresa  E ON E.id_empresa  = C.id_terceirizada
 WHERE C.id_contratante = 1;

-- 7) Resumo do financeiro (cards "Total a Pagar / Pago / Pendentes")
SELECT SUM(CASE WHEN status <> 'PAGA'     THEN valor ELSE 0 END) AS total_a_pagar,
       SUM(CASE WHEN status =  'PAGA'     THEN valor ELSE 0 END) AS total_pago,
       SUM(CASE WHEN status =  'PENDENTE' THEN valor ELSE 0 END) AS pendentes
  FROM fatura;
