const sharedOptions = require('@n8n_io/eslint-config/shared');

/**
 * @type {import('@types/eslint').ESLint.ConfigData}
 */
module.exports = {
	extends: ['@n8n_io/eslint-config/base'],

	...sharedOptions(__dirname),

	ignorePatterns: ['src/expressions/grammar*.ts'],
};
