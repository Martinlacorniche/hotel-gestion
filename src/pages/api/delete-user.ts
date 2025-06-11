// pages/api/delete-user.ts

import { createClient } from '@/lib/supabaseClient';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // clé secrète côté serveur uniquement
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { id_auth } = req.body;

  if (!id_auth) return res.status(400).json({ error: 'Missing id_auth' });

  const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(id_auth);
  if (deleteUserError) return res.status(500).json({ error: deleteUserError.message });

  const { error: deleteRowError } = await supabaseAdmin.from('users').delete().eq('id_auth', id_auth);
  if (deleteRowError) return res.status(500).json({ error: deleteRowError.message });

  return res.status(200).json({ success: true });
}
