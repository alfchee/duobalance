// Placeholder Database type. #9 populates this from `supabase gen types typescript`.
// Until then, callers should pass a permissive type so the build is not blocked.
// The shape matches Supabase's GenericSchema so `createBrowserClient<Database>` type-checks
// without `any`. Tables / Views / Functions are empty `Record`s — every column lookup will
// fail to type-check, which is the correct signal that the schema is not yet generated.
type Empty = Record<string, never>;
export type Database = {
  public: {
    Tables: Empty;
    Views: Empty;
    Functions: Empty;
    Enums: Empty;
    CompositeTypes: Empty;
  };
};
