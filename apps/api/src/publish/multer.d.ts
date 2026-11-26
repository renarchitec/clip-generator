// The cover interceptor uses Multer's in-memory storage. Declare only the
// file shape this API consumes, without adding a workspace dependency.
declare namespace Express.Multer {
  interface File {
    buffer: Buffer;
  }
}
