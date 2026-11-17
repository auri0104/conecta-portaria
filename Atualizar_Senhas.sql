-- Atualiza as senhas dos usuarios de demonstracao (senha: conecta123)
-- Use se voce ja rodou a versao antiga do CONECTA_Banco.sql.
USE conecta;
ALTER TABLE usuario MODIFY senha_hash VARCHAR(200) NOT NULL;
UPDATE usuario SET senha_hash = 'scrypt$a338d8e2784b1241$6978c201dcdf248d7b91227603a2a4527916d73ecaa0cc3e84bb7c4c399ec923' WHERE id_usuario = 1;
UPDATE usuario SET senha_hash = 'scrypt$6a6e8123875e2a8d$61b85257f9be10926373b83255fb6b672de26404c2d718271172bd4d844280e2' WHERE id_usuario = 2;
UPDATE usuario SET senha_hash = 'scrypt$ed9b794787e78a35$b30fab61c0b3592704590567d6978cb8a5e903dc7d6aef8797c6a5afbd8f6b0d' WHERE id_usuario = 3;
