declare namespace Cloudflare {
  interface Env {
    APP_ENV?: string;
    CLUB_TABLE?: DurableObjectNamespace;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
