const handlebars = require("handlebars");
const fs = require("fs");
const path = require("path");
const url = require("url");
const accept_language_parser = require('accept-language-parser');
const client_config = require("./client_configuration");

/**
 * Associations from language to translation dictionnaries
 * @const
 * @type {object}
 */
const TRANSLATIONS = JSON.parse(fs.readFileSync(path.join(__dirname, "translations.json")));
const languages = Object.keys(TRANSLATIONS);

handlebars.registerHelper({
    json: JSON.stringify.bind(JSON)
});

function findBaseUrl(req) {
    var proto = req.headers['X-Forwarded-Proto'] || (req.connection.encrypted ? 'https' : 'http');
    var host = req.headers['X-Forwarded-Host'] || req.headers.host;
    return proto + '://' + host;
}

class Template {
    constructor(path) {
        const contents = fs.readFileSync(path, { encoding: 'utf8' });
        this.template = handlebars.compile(contents);
    }
    parameters(parsedUrl, request) {
        const accept_languages = parsedUrl.query.lang || request.headers['accept-language'];
        const opts = { loose: true };
        const language = accept_language_parser.pick(languages, accept_languages, opts) || 'en';
        const translations = TRANSLATIONS[language] || {};
        const configuration = client_config || {};
        const prefix = request.url.split("/boards/")[0].substr(1);
        const baseUrl = findBaseUrl(request) + (prefix ? prefix + "/" : "");
        return { baseUrl, languages, language, translations, configuration };
    }
    serve(request, response) {
        const parsedUrl = url.parse(request.url, true);
        const parameters = this.parameters(parsedUrl, request);
        var body = this.template(parameters);
        var headers = {
            'Content-Length': Buffer.byteLength(body),
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=3600',
        };
        if (!parsedUrl.query.lang) {
            headers["Vary"] = 'Accept-Language';
        }
        response.writeHead(200, headers);
        response.end(body);
    }
}

class BoardTemplate extends Template {
    parameters(parsedUrl, request) {
        const params = super.parameters(parsedUrl, request);
        const parts = parsedUrl.pathname.split('boards/', 2);
        const boardUriComponent = parts[1];
        params['boardUriComponent'] = boardUriComponent;
        params['board'] = decodeURIComponent(boardUriComponent);
        return params;
    }
}

module.exports = { Template, BoardTemplate };