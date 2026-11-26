// expect: OLDMAN-C01@4, OLDMAN-C01@7
/*
 * Parses the header.
 * Updated to support version 2 headers.
 */
function parse(header) {
  return header.trim(); // Renamed from cleanHeader
}
module.exports = { parse };
