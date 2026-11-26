// Archived operator demo issuance: the public #/preview interface is retired.
// Fail closed before importing configuration, opening a database connection,
// generating a PIN or revoking any previously issued session.
// The authenticated administrator test center and isolated sandbox are separate.
console.error('Старый публичный просмотр #/preview закрыт. Код не создан.');
console.error('Используйте действующий вход администратора и изолированный sandbox.');
console.error('Инструкция: deploy/FULL_FIDELITY_SANDBOX.md');
process.exitCode = 1;
export {};
