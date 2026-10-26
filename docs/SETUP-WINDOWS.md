# ApexForge on Windows — step by step

Do one part at a time. Every part ends with a **✅ Status check**. If your screen doesn't match, use the **⚠️ If something goes wrong** box. If you're still stuck, copy what you see (or take a screenshot) and send it to Claude with the part number, e.g. *"Stuck on Part 2, step 4, here's the message."*

**Time:** Parts 1–4 take about an hour, mostly waiting on downloads. Parts 5–10 can be spread over a week.

| Part | What you'll have at the end | Time |
|---|---|---|
| 1 | The free tools installed | 20 min |
| 2 | ApexForge downloaded to your PC | 10 min |
| 3 | The local AI writer installed | 15 min |
| 4 | The admin panel open in your browser | 5 min |
| 5 | Your life insurance site filled in with your details | 30 min |
| 6 | AI-written pages, reviewed by you | 1–2 hrs over a few days |
| 7 | A booking link so leads schedule your calls | 15 min |
| 8 | Your domain + Cloudflare account | 30 min |
| 9 | Your site live on the internet | 30 min |
| 10 | A test lead in your admin, Google notified | 20 min |

---

## Part 1 — Install the free tools

You'll use **Terminal**, a window where you type commands. Don't worry, you'll copy and paste every command from this guide.

1. Press the **Windows key**, type **Terminal**, and open it. (On older Windows 10, search for **PowerShell** instead.)
2. Paste this line and press **Enter**. It installs Git (which downloads ApexForge and saves your work):
   ```
   winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
   ```
3. Then this one (Node.js, which runs ApexForge):
   ```
   winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
   ```
4. Then this one (Ollama, the AI writer that runs on your graphics card):
   ```
   winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
   ```
5. **Close Terminal completely and open it again.** New tools only show up in a fresh window.
6. Paste these three lines, one at a time:
   ```
   git --version
   node --version
   ollama --version
   ```

> **✅ Status check:** you see three version numbers, something like `git version 2.x`, `v22.x` or `v24.x`, and `ollama version 0.x`.

> **⚠️ If something goes wrong**
> - **"winget is not recognized":** install each one from its website instead, clicking through the installer with the default options: [git-scm.com/download/win](https://git-scm.com/download/win), [nodejs.org](https://nodejs.org) (the **LTS** button), [ollama.com/download](https://ollama.com/download). Then do steps 5–6.
> - **"node is not recognized" after installing:** restart your computer, then try step 6 again.
> - **Node shows v18 or v20:** install the newer LTS from nodejs.org. ApexForge needs version 22 or higher.

7. Tell Git who you are (it labels your saved changes). Use your name and the email on your GitHub account:
   ```
   git config --global user.name "Your Name"
   git config --global user.email "you@example.com"
   ```

---

## Part 2 — Download ApexForge

1. In Terminal, go to your Documents folder:
   ```
   cd $HOME\Documents
   ```
2. Download ApexForge from your GitHub:
   ```
   git clone https://github.com/bawcejawn/ApexForge.git
   ```
3. Go into the folder and install its parts (takes 2–4 minutes; lots of text scrolling by is normal):
   ```
   cd ApexForge
   npm install
   ```
4. Run the built-in checks:
   ```
   npm test
   ```

> **✅ Status check:** the last lines of `npm test` include **`# pass 11`** and **`# fail 0`**. You now have a folder **Documents\ApexForge**.

> **⚠️ If something goes wrong**
> - **"running scripts is disabled on this system":** paste this, press Enter, type **Y**, Enter, then repeat the command that failed:
>   ```
>   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
>   ```
> - **"npm ERR! network":** check your internet, then run `npm install` again. It picks up where it left off.
> - **Any test fails:** copy the red text and send it to Claude.

---

## Part 3 — Install the AI writer

Ollama writes your website pages on your own PC for free. Your RTX 3070 Ti handles this model well.

1. In Terminal:
   ```
   ollama pull llama3.1:8b
   ```
   This downloads about 5 GB. Let it finish.
2. Check it:
   ```
   ollama list
   ```

> **✅ Status check:** `ollama list` shows **llama3.1:8b**. You'll also see a small llama icon in the system tray (bottom-right, near the clock). That means it's running.

> **⚠️ If something goes wrong**
> - **"could not connect to ollama":** open **Ollama** from the Start menu once, then try again.
> - **Download keeps failing:** try again later. It resumes. Until then, ApexForge uses built-in template text, so you're not blocked.

---

## Part 4 — Open the admin panel

From now on you can mostly skip Terminal.

1. Open **File Explorer → Documents → ApexForge**.
2. Double-click **`Start-ApexForge.cmd`**. A black window opens, and after a few seconds your browser opens the admin.
   - *If Windows shows "Windows protected your PC": click **More info → Run anyway**. It's the file from your own repo.*
3. **Keep the black window open** while you work. Closing it stops the admin.

> **✅ Status check:** your browser shows **ApexForge** at `http://127.0.0.1:4400` with an **Overview** page listing three sites: **Grand Strand Life Quotes**, **Grand Strand Home Value**, and **Grand Strand Mortgage Match**. Under **Settings**, the AI writer box shows a green **Ollama running** pill.

> **⚠️ If something goes wrong**
> - **Browser says "can't reach this page":** wait 5 seconds and refresh. If it still fails, look at the black window for a red error and send it to Claude.
> - **"Reload the admin page":** just refresh the browser (this happens after restarting the admin).
> - **Ollama shows "not reachable":** open Ollama from the Start menu, then refresh the Settings page.

Tip: right-click `Start-ApexForge.cmd` → **Show more options → Send to → Desktop (create shortcut)** for a desktop icon.

**🛑 Checkpoint:** tell Claude "Part 4 done" (or what went wrong) before continuing. Claude can then help you with your business details in Part 5.

---

## Part 5 — Put your details into the life insurance site

In the admin: **Sites → Grand Strand Life Quotes → Settings**. Fields with an **orange border** still say TODO.

1. **Brand:** keep "Grand Strand Life Quotes" or choose your own. *(Check the domain is available first, Part 8, step 2.)*
2. **Domain:** leave the TODO until you buy it in Part 8.
3. **Your business:** legal name (your agency or LLC), business address, and the email leads should reply to.
4. **Buyers:** your name or agency exactly as you want it in the consent box, and your **SC Insurance Producer license number**.
5. **Content reviewer:** your name, "Licensed South Carolina life insurance agent", and a two-sentence bio.
6. **Cities:** each one already has local facts from research. Read them, fix anything you know is wrong, and add anything you know locally (a big employer, a retirement community, a hospital).
7. Click **Save changes** at the bottom.

> **✅ Status check:** **Sites → Grand Strand Life Quotes → Overview**: the checklist shows green for **Business details**, **Named buyer** and **Real content reviewer**.

> **⚠️** Don't put anything secret here (no passwords, SSNs). This file is visible in your public GitHub repo until you make it private.

---

## Part 6 — Write and review the pages

The homepage and three key pages are already written. The rest use starter template text, which you'll upgrade with AI.

1. **Sites → Grand Strand Life Quotes → Pages & content → Upgrade template pages with AI.** A log opens at the bottom right. With your graphics card, expect roughly 20–60 seconds per page, so the full set takes about 20–40 minutes. You can keep using your PC.
2. When it says **finished**, click any page to open the editor. For each page:
   - Read it. Fix anything wrong or anything you'd never say to a client.
   - Red **Compliance flags** = phrases to rewrite (prices, rates, "guaranteed", approval claims).
   - Tick **"I read and checked this page"**, then **Save & next**.
3. Do 5–10 pages a night. It doesn't have to be done in one sitting.

> **✅ Status check:** **Pages & content**: the **Review** column says **reviewed** for every page, and the Overview checklist shows **Every page human-reviewed** in green.

> **⚠️** Pages say "template" instead of "ollama" after the upgrade? Ollama wasn't running. Open it from the Start menu and click **Upgrade template pages with AI** again.

---

## Part 7 — Let leads book your calls (free)

This is what lets you keep a full-time job: leads pick a time that suits you.

1. Go to [cal.com](https://cal.com) and sign up free (or use **Google Calendar → Create → Appointment schedule** if you use Gmail).
2. Create an event type called **"Quote call"**, 15 minutes. Set your available hours (e.g. weekdays 12:00–1:00 and 5:30–8:30 p.m., Saturday morning). Add a question asking for their phone number.
3. Copy the event's link (looks like `https://cal.com/yourname/quote-call`).
4. Admin → **Sites → Grand Strand Life Quotes → Settings → Booking link**: paste it, **Save changes**.

> **✅ Status check:** **Build & publish → Start preview**, open `http://localhost:4321/thank-you/`, and you see a **Pick my call time** button. (Stop the preview from the log panel when done.)

---

## Part 8 — Buy your domain and set up Cloudflare (free account, ~$10/yr domain)

1. Create a free account at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. In Cloudflare: **Domain Registration → Register Domains**. Search for your brand (e.g. *grandstrandlifequotes.com*). Pick a **.com** that's short and easy to say on the phone. Buy it (Cloudflare charges cost price, about $10–11/year).
3. Admin → **Sites → Grand Strand Life Quotes → Settings → Domain**: type the domain (no `https://`), **Save changes**.
4. Admin → **Settings → Cloudflare**, click in order and wait for each log to say **finished**:
   1. **Log in** — a browser tab opens; click **Allow**.
   2. **Create database**
   3. **Apply schema**
5. Admin → **Settings → Leads → ADMIN_TOKEN → Generate**, then **Save settings**. Copy that token into a password manager or a note only you can see. You'll paste it into Cloudflare in Part 9.

> **✅ Status check:** **Overview → Setup** shows green for **Lead database created on Cloudflare** and **Admin token set**.

> **⚠️** **"Create database" says it already exists:** that's fine. Open `wrangler.toml` in the ApexForge folder with Notepad and check `database_id` isn't all zeros. If it is, send the log to Claude.

---

## Part 9 — Put the site live

1. Admin → **Sites → Grand Strand Life Quotes → Build & publish → Build**, then **Deploy**. The first deploy creates a project called **horry-life** in Cloudflare and gives you a temporary address like `horry-life.pages.dev`.
2. In Cloudflare: **Workers & Pages → horry-life → Settings**:
   1. **Bindings → Add → D1 database**: variable name **`DB`**, database **`apexforge-leads`** → Save.
   2. **Variables and secrets → Add**: name **`ADMIN_TOKEN`**, type **Secret**, value = the token from Part 8 step 5 → Save.
   3. *(Optional, recommended)* Instant lead alerts on your phone: in the free **Discord** app, make a private server → channel settings → **Integrations → Webhooks → New webhook → Copy URL**. Add a variable **`NOTIFY_WEBHOOK`** with that URL.
3. **Custom domains → Set up a custom domain** → your domain → follow the prompts (it's automatic when the domain is on Cloudflare).
4. Back in the admin: **Build & publish → Deploy** again (bindings apply on the next deploy).
5. Admin → **Settings → Leads → LEAD_APIS**: type `https://yourdomain.com`, **Save settings**.

> **✅ Status check:** visiting `https://yourdomain.com` shows your site with the padlock icon. (A new domain can take 5–30 minutes to start working.)

---

## Part 10 — Test it, then tell Google

1. On your phone, open your site and fill out the form with **your own** details. Check the consent box and submit.
2. You should land on the thank-you page (and get a Discord ping if you set it up).
3. Admin → **Leads → Pull new leads**. Your test lead appears with a tier and score. Click it to see the **Quote sheet**. Set it to **bad** with the note "test".
4. Google: go to [search.google.com/search-console](https://search.google.com/search-console) → **Add property → Domain** → your domain → follow the verify step (Cloudflare can add the record for you) → **Sitemaps** → enter `sitemap-index.xml` → Submit.
5. Do the same at [bing.com/webmasters](https://www.bing.com/webmasters) (you can import from Google in one click).

> **✅ Status check:** your test lead shows in **Leads**, and Search Console shows the sitemap as **Success** (can take a day).

**🛑 Checkpoint:** tell Claude "Part 10 done". Next: **Guides → Go live** (business email, automatic emails, bot check, and your first partner). Then repeat Parts 5–10 for the real-estate and mortgage sites.

---

## Saving your work and getting updates

- **Double-click `Sync-ApexForge.cmd`** before and after each session with Claude. It saves your edits to GitHub and pulls in anything Claude has added.
- The first time, a GitHub sign-in window appears. Sign in and approve.
- Your `.env` file (keys and passwords), `data\` folder (leads) and `private\` folder (partner contacts) never go to GitHub.
- Sync also copies `private\partners.json` to **Documents\ApexForge-backup** each time, so your partner list isn't lost if the PC dies. Copy that folder to OneDrive or a USB drive now and then.

## Everyday routine (about 15 minutes a day)

1. Double-click **Start-ApexForge.cmd**.
2. **Leads → Pull new leads**.
3. Open each new lead → read the **Quote sheet** → run quotes → call at their booked time using **Guides & scripts**.
4. Update each lead's **status** and **notes** right after the call.
