// Conexión de LIA con Supabase.
// Ambos valores son públicos por diseño: la seguridad la dan las políticas RLS y las funciones de la base de datos.
// Cópialos de Supabase → Project Settings → API Keys: la "Project URL" y la clave "publishable" (o la "anon" heredada).
// Nunca pongas aquí la clave secreta ni la "service_role".
// Si se dejan vacíos, LIA funciona solo en Gratis y no ofrece cuentas.
window.LIA_SUPABASE = {
  url: '',
  key: ''
};
