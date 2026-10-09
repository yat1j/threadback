# THREADBACK

**Turn your WhatsApp conversations into meaningful, evidence-backed briefings.**

THREADBACK is a privacy-first conversation analysis tool designed to help users understand patterns, themes, and important moments hidden in their WhatsApp chat history.

## ✨ Features

- **Chat analysis:** Extract meaningful insights from exported WhatsApp conversations.
- **Date-based filtering:** Focus on conversations within a selected time range.
- **Evidence-backed findings:** Connect insights to their original messages where supported.
- **Local AI processing:** Designed to run language-model inference directly in the browser.
- **Privacy-first approach:** Chat content is intended to remain on the user's device rather than being uploaded to a cloud AI model.

## 🚀 Getting Started

### Prerequisites

- Node.js and npm
- A modern browser
- A compatible device and browser for local AI inference

### Installation

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/threadback.git
cd threadback
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL printed in your terminal.

### Usage

1. Export a WhatsApp conversation using WhatsApp's chat export feature.
2. Import the exported chat into THREADBACK.
3. Select the relevant date range and review the detected messages.
4. Start the analysis and explore the resulting briefing.

The initial local AI model download may take time and requires a compatible browser and sufficient device resources.

## 🔒 Privacy

THREADBACK is designed around browser-based processing and local AI inference. Verify that all processing paths and dependencies behave as intended before using sensitive conversations.

Do not upload private chat exports, credentials, API keys, or other sensitive information to a public repository.

## 🛠️ Technology

- Next.js
- React
- TypeScript
- Browser-based local AI inference

## ⚠️ Current Limitations

- Initial model downloads can be large and may take time.
- Local inference performance depends on the device and browser.
- Analysis quality depends on correct chat parsing and date interpretation.

## 📄 License

See the `LICENSE` file for the project's license.

---

Built with a focus on privacy, clarity, and meaningful conversation insights.
