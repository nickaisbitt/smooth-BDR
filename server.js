import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API Route: Send Email
app.post('/api/send-email', async (req, res) => {
    const { smtpConfig, email } = req.body;

    if (!smtpConfig || !email) {
        return res.status(400).json({ error: "Missing config or email data" });
    }

    try {
        // Create Transporter using User's Credentials
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: parseInt(smtpConfig.port),
            secure: smtpConfig.secure, // true for 465, false for other ports
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.pass,
            },
        });

        // Send Email
        const info = await transporter.sendMail({
            from: `"${email.fromName}" <${smtpConfig.user}>`, // Sender address
            to: email.to,
            subject: email.subject,
            text: email.message, 
            html: email.message.replace(/\n/g, '<br>'), // Basic HTML conversion
        });

        console.log("Message sent: %s", info.messageId);
        res.status(200).json({ success: true, messageId: info.messageId });

    } catch (error) {
        console.error("SMTP Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Serve React App (Production)
// In production, we serve the built files from 'dist'
const distPath = join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
        res.sendFile(join(distPath, 'index.html'));
    });
} else {
    console.log("Dev Mode: API Server running. React app handled by Vite.");
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});