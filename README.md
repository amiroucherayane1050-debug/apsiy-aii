# Apsiy Ai

Plateforme de génération de vidéos IA avec authentification Supabase, crédits atomiques, paiement Stripe Checkout et génération fal.ai.

## Sécurité des crédits

- Chaque route privée vérifie le jeton Supabase côté serveur.
- Le débit d’un crédit est atomique dans PostgreSQL avant tout appel à fal.ai.
- Une génération n’est consultable que par son propriétaire.
- Un échec terminal rembourse le crédit avec une clé d’idempotence.
- Les crédits Stripe sont attribués uniquement après vérification cryptographique du webhook ou relecture serveur de la Checkout Session.
- Les événements Stripe répétés ne créditent jamais deux fois le même achat.
- Le navigateur ne possède ni clé fal.ai, ni clé Stripe secrète, ni clé Supabase `service_role`.

## Variables Vercel requises

```text
APP_URL=https://apsiy-aiii.vercel.app
FAL_KEY=...
SUPABASE_URL=https://ecpyezbpnoezmhwrwaeb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
STRIPE_MODE=test
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Ne jamais ajouter les valeurs secrètes au dépôt Git.

## Mise en place

1. Exécuter `supabase/migrations/001_secure_credits.sql` dans le SQL Editor du projet Supabase.
2. Créer dans Stripe **Test mode** un produit à 9,99 € avec un prix unique, puis copier son identifiant dans `STRIPE_PRICE_ID`.
3. Ajouter un webhook Stripe vers `https://apsiy-aiii.vercel.app/api/stripe-webhook` pour les événements `checkout.session.completed` et `checkout.session.async_payment_succeeded`.
4. Ajouter les variables ci-dessus aux environnements Vercel Production, Preview et Development selon le besoin.
5. Déployer, tester une connexion, un paiement de test, un débit et un remboursement.

Pour passer en production plus tard, définir explicitement `STRIPE_MODE=live` et remplacer ensemble la clé secrète, le prix et le secret webhook par leurs versions live.

## Vérification locale

```bash
npm install
npm run check
```
