// Human-typable join codes. Avoids ambiguous characters (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateJoinCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    // Math.random is fine here: collisions are checked against the DB and
    // this is not a security token.
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
