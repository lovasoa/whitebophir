function parseIntegerEnv(name, defaultValue) {
  const value = process.env[name];
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseEnumEnv(name, allowedValues, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;

  const normalizedValue = value.toLowerCase();
  const match = allowedValues.find(function findAllowed(candidate) {
    return candidate.toLowerCase() === normalizedValue;
  });
  if (match) return match;

  throw new Error(
    "Invalid " +
      name +
      ": " +
      value +
      ". Expected one of: " +
      allowedValues.join(", "),
  );
}

module.exports = {
  parseEnumEnv,
  parseIntegerEnv,
};
