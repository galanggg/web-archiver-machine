# Web Archiver

Your personal, offline time machine. 

Web Archiver is a Node.js-based tool that allows you to crawl and download a fully functional, offline copy of a website. It intercepts network requests, rewrites HTML assets to point to local files, and even injects a standalone offline interceptor to ensure Single Page Applications (SPAs) function correctly without an internet connection. It also includes a beautiful web dashboard to view and export your saved archives.

**[Watch the Demo Video](https://drive.google.com/file/d/1GD3D_MJoqc___MVJasgwbsWysnfVUrGR/view?usp=sharing)**

## Features

- **Headless Crawling:** Uses Puppeteer to fully render and capture pages, including dynamic content.
- **Asset Interception:** Downloads CSS, JS, Images, Media, and API responses automatically.
- **Offline Brain:** Injects a custom standalone interceptor script into saved HTML files to route `fetch` and `XHR` requests to your local assets.
- **Web Dashboard:** A clean, responsive UI to browse, view, and manage your captured sites.
- **Zip Export:** Dynamically generate `.zip` archives of your saved websites straight from the dashboard.
- **Scheduling:** Run the archiver on a continuous loop using the `--schedule` flag.

## Tech Stack

- **Node.js**: The core runtime environment.
- **Puppeteer**: For headless browser automation and network interception.
- **Cheerio**: For efficient HTML parsing and asset URL rewriting.
- **Express.js**: Powers the web dashboard and static file serving.
- **Archiver**: Generates `.zip` files for easy exporting.

## Installation

1. **Clone the repository:**
   Ensure you have the project files on your local machine.

2. **Install dependencies:**
   Navigate to the project root directory and run:
   ```bash
   npm install
   ```
   *(This will install Puppeteer, Express, Cheerio, and Archiver as defined in your `package.json`)*

## Usage

The project consists of two main components: the Archiver (CLI) and the Server (Dashboard).

### 1. Archiving a Website (CLI)

Use `archiver.js` to start crawling a website. It requires a target URL.

```bash
node archiver.js https://example.com
```

**Options:**
- `--schedule <minutes>`: Run the archiver on a continuous loop every X minutes.
  ```bash
  node archiver.js https://example.com --schedule 60
  ```

*Archives are saved in the `archives/` directory, organized by domain and timestamp.*

### 2. Viewing Your Archives (Web Dashboard)

Use `server.js` to start the web interface.

```bash
node server.js
```

Once the server is running, open your browser and navigate to:
**http://localhost:3000**

From the dashboard, you can:
- See a list of all your captured websites.
- View the number of pages and assets captured.
- Click **"View Offline"** to browse the fully functional offline copy.
- Click **"Export .zip"** to download the archive to your computer.

## Project Structure

Following recent optimizations and refactoring, the project is structured as follows:

```text
.
├── archiver.js              # CLI entry point for the web crawler
├── server.js                # Express.js web server for the dashboard
├── package.json             # Project dependencies
├── src/                     # Core archiver modules
│   ├── crawler.js           # Puppeteer crawling and navigation logic
│   ├── assetManager.js      # Intercepts and saves network responses
│   ├── htmlProcessor.js     # Cheerio logic for rewriting asset URLs
│   └── interceptor.template.html # Template for the offline routing script
├── public/                  # Dashboard UI templates
│   ├── index.html           # Main dashboard layout
│   └── card.html            # Template for individual archive cards
└── archives/                # Generated folder where captured sites are stored
```

## Architecture

For a deep dive into the methodology and engineering decisions behind this tool—including how it handles modern SPAs (React, Vue, Next.js), AOT API interception, and portable asset extraction—please refer to the [ARCHITECTURE.md](ARCHITECTURE.md) file.

