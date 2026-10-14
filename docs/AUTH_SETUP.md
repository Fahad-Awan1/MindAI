# Email codes and Google sign-in: setup

MindAI's account security works like this:
- **Confirm your email:** new accounts get a 6-digit code by email and can't sign in until they enter it. Accounts created before this feature count as already confirmed.
- **Forgot password:** a 6-digit code by email, then a new password. Every other device is signed out.
- **Continue with Google:** works on the website and in the Android app.

Until you finish the steps below, the app still works:
- **Codes** are printed in the backend terminal instead of being emailed (look for `--- EMAIL`).
- **The Google button** is simply hidden.

## 1. Send real emails from Gmail (free, about 5 minutes)

1. Open https://myaccount.google.com/security and turn on **2-Step Verification**. Gmail requires it for app passwords.
2. Open https://myaccount.google.com/apppasswords and create an app password named **MindAI**. Google shows a 16-letter password once, so copy it.
3. Add these lines to `backend/.env`, using your own Gmail address and the app password without spaces:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=yourname@gmail.com
   SMTP_PASSWORD=abcdabcdabcdabcd
   MAIL_FROM_NAME=MindAI
   ```
4. Restart the backend.

Emails arrive as **"MindAI"** with the branded design. The sender address underneath is your Gmail address. Gmail allows about 500 emails a day.

**Later, with your own domain** (for a `no-reply@yourdomain.com` sender that lands in the inbox, not spam):
- Sign up at https://resend.com and verify the domain (they show the DNS records to add).
- Then change only these values:
  ```
  SMTP_HOST=smtp.resend.com
  SMTP_PORT=587
  SMTP_USER=resend
  SMTP_PASSWORD=<your Resend API key>
  MAIL_FROM=no-reply@yourdomain.com
  ```

## 2. Google sign-in (about 10 minutes, in Google Cloud Console)

1. Go to https://console.cloud.google.com and create a project named **MindAI**.
2. Set up **Google Auth Platform → Branding** (the OAuth consent screen):
   - App name **MindAI**, your support email, and optionally the logo `frontend/public/icon-512.png`.
   - Audience: **External**.
   - While the app is in "Testing", only the Google accounts you add under **Test users** can sign in. Choose **Publish app** when you are ready for everyone; basic sign-in (email and profile) needs no review.
3. Create two OAuth clients under **Clients → Create client**:
   - **Web application**
     - Name: `MindAI Web`.
     - **Authorized JavaScript origins:** add `http://localhost:5173` and your public address, for example `https://xxxx.trycloudflare.com` (add each new tunnel address, or your hosted domain later).
     - No redirect URIs are needed.
     - Copy its **Client ID**.
   - **Android**
     - Package name: `com.mindai.app`.
     - SHA-1 certificate fingerprint (the debug key on this PC):
       ```
       B7:12:B6:3F:7A:CA:DD:67:CC:86:D7:5F:1D:09:FF:FE:16:34:CB:FD
       ```
     - When you make a signed release build for the Play Store, add that key's SHA-1 too.
4. Put the **Web** client ID in three places. The Android app also uses the Web client ID, so the backend accepts tokens for it:
   - `backend/.env`: `GOOGLE_CLIENT_IDS=<web client id>`
   - `frontend/.env` (create it if missing): `VITE_GOOGLE_CLIENT_ID=<web client id>`
   - `frontend/.env.mobile`: `VITE_GOOGLE_CLIENT_ID=<web client id>`
5. Restart the backend and `npm run dev`, then rebuild the app (`npm run build:mobile`, then `gradlew assembleDebug` in `frontend/android`).

## How it behaves
- **Codes:** they expire after 15 minutes and work once. Five wrong tries burn the code. You can ask for a new code once a minute, and at most 5 times an hour.
- **Forgot password** gives the same answer whether or not the email has an account, so nobody can probe which emails are registered.
- **Google sign-in with an existing email** links Google to that account; the password keeps working too. A brand-new Google user has no password and can set one any time with "Forgot password?".
- **Changing or resetting the password** signs out every other device.
