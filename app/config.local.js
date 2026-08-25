/**
 * WALLET · Configuration du serveur
 *
 * Ces deux valeurs pointent vers le projet Supabase "WALLET".
 * La cle "anon" est PUBLIQUE par conception : elle ne donne acces a rien sans
 * authentification, c'est la Row Level Security qui protege les donnees.
 * Ne mettez JAMAIS la cle "service_role" ici.
 */

window.WALLET_CONFIG = {
  supabaseUrl: 'https://qjxeimsinxqvlodsusww.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqeGVpbXNpbnhxdmxvZHN1c3d3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NzY1NzksImV4cCI6MjEwMzI1MjU3OX0.I9igzeqpZlmMryY8qh4ttuXT8OflBP2rVhBy6LFJ6RQ',
};
