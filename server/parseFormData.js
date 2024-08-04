const multiparty = require('multiparty');

async function parseFormData(request) {
  const parser = new multiparty.Form();
  return new Promise((resolve, reject) => {
    parser.parse(request, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

module.exports = parseFormData;
