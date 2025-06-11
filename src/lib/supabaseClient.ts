import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://drdlcohzfjdogyquglcs.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyZGxjb2h6Zmpkb2d5cXVnbGNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk1NDk1NDYsImV4cCI6MjA2NTEyNTU0Nn0.uPRYdTX9F0ccSdCTcUta7UyzahcPCZeFmoxIpuKamME';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
