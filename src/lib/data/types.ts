import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';

/** The client type every data-access function accepts. */
export type Db = SupabaseClient<Database>;
