const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from current directory
app.use(express.static(__dirname));

// Configure Multer for file upload (keep in memory to forward)
const upload = multer({ storage: multer.memoryStorage() });

// Newebpay Configuration (Uses environment variables in production, fallback to test values for local dev)
const NEWEBPAY_CONFIG = {
    merchantID: process.env.MerchantID || 'MS152693474',
    hashKey: process.env.HASHKEY || 'jKNxcpnMtZx2ygaBYKeaWdT0w4Usl9HZ',
    hashIV: process.env.HASHIV || 'CAAevAsTggx5zG6P',
    paymentURL: process.env.PayGateWay || 'https://ccore.newebpay.com/MPG/mpg_gateway',
    returnURL: process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/api/payment-return` : 'http://localhost:3000/api/payment-return',
    notifyURL: process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/api/payment-callback` : 'http://localhost:3000/api/payment-callback',
    version: '2.0'
};

// In-memory storage for pending analysis results
const pendingResults = new Map();
const paidResults = new Map();

// Helper: AES Encrypt for Newebpay
function aesEncrypt(data, key, iv) {
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}

// Helper: AES Decrypt for Newebpay
function aesDecrypt(encryptedData, key, iv) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Helper: Create TradeInfo for Newebpay
function createTradeInfo(orderData) {
    const tradeInfoString = Object.keys(orderData)
        .map(key => `${key}=${orderData[key]}`)
        .join('&');

    return aesEncrypt(tradeInfoString, NEWEBPAY_CONFIG.hashKey, NEWEBPAY_CONFIG.hashIV);
}

// Helper: Create TradeSha for Newebpay
function createTradeSha(tradeInfo) {
    const hashString = `HashKey=${NEWEBPAY_CONFIG.hashKey}&${tradeInfo}&HashIV=${NEWEBPAY_CONFIG.hashIV}`;
    return crypto.createHash('sha256').update(hashString).digest('hex').toUpperCase();
}

// Proxy Endpoint - Modified to return orderId instead of results
app.post('/api/analyze', upload.single('resume'), async (req, res) => {
    console.log('Received analysis request');

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No resume file uploaded' });
        }

        const formData = new FormData();
        formData.append('userId', req.body.userId);
        formData.append('jobResponsibilities', req.body.jobResponsibilities);
        formData.append('jobRequirements', req.body.jobRequirements);
        formData.append('resume', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        console.log('Forwarding to n8n webhook...');

        const webhookUrl = 'https://lukelu.zeabur.app/webhook/Luke';
        const response = await fetch(webhookUrl, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders()
        });

        console.log(`n8n responded with status: ${response.status}`);
        const responseText = await response.text();
        console.log('n8n response body:', responseText);

        if (!response.ok) {
            return res.status(response.status).send(responseText);
        }

        // Generate unique order ID
        const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store analysis result temporarily (pending payment)
        pendingResults.set(orderId, {
            result: responseText,
            userId: req.body.userId,
            timestamp: new Date()
        });

        console.log(`Analysis complete. Order ID: ${orderId}`);

        // Extract preview from analysis result (first few lines)
        let preview = '';
        try {
            const analysisData = JSON.parse(responseText);
            if (Array.isArray(analysisData) && analysisData.length > 0) {
                const overallReview = analysisData[0].overallReview || analysisData[0]['Overall Review'] || '';
                // Get first 3 lines or 200 characters as preview
                const lines = overallReview.split('\n').filter(line => line.trim() !== '');
                preview = lines.slice(0, 3).join('\n');
                if (preview.length > 200) {
                    preview = preview.substring(0, 200) + '...';
                }
            }
        } catch (e) {
            console.log('Could not parse preview:', e);
            preview = responseText.substring(0, 200) + '...';
        }

        // Return order ID with preview
        res.json({
            success: true,
            orderId: orderId,
            preview: preview,
            message: 'Analysis complete. Please proceed to payment.'
        });

    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create Payment Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { orderId, discountCode } = req.body;

        if (!pendingResults.has(orderId)) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const orderData = pendingResults.get(orderId);
        const timestamp = Date.now();

        // Discount code validation
        const VALID_DISCOUNT_CODES = {
            'JOYFU05': {
                rate: 0.85, // 85折
                description: '85折優惠'
            }
        };

        let finalAmount = 100; // Default price
        let discountApplied = false;

        if (discountCode && VALID_DISCOUNT_CODES[discountCode.toUpperCase()]) {
            const discount = VALID_DISCOUNT_CODES[discountCode.toUpperCase()];
            finalAmount = Math.round(100 * discount.rate); // 100 * 0.85 = 85
            discountApplied = true;
            console.log(`Discount code ${discountCode} applied. Final amount: NT$${finalAmount}`);
        }

        // Prepare Newebpay order data
        const newebpayOrder = {
            MerchantID: NEWEBPAY_CONFIG.merchantID,
            RespondType: 'JSON',
            TimeStamp: timestamp,
            Version: NEWEBPAY_CONFIG.version,
            MerchantOrderNo: orderId,
            Amt: finalAmount, // Use discounted amount
            ItemDesc: discountApplied ? `履歷透視鏡分析服務 (折扣碼: ${discountCode})` : '履歷透視鏡分析服務',
            ReturnURL: NEWEBPAY_CONFIG.returnURL,
            NotifyURL: NEWEBPAY_CONFIG.notifyURL,
            Email: orderData.userId || 'test@example.com',
            LoginType: 0
        };

        const tradeInfo = createTradeInfo(newebpayOrder);
        const tradeSha = createTradeSha(tradeInfo);

        console.log(`Payment order created: ${orderId}, Amount: NT$${finalAmount}`);

        res.json({
            success: true,
            paymentData: {
                MerchantID: NEWEBPAY_CONFIG.merchantID,
                TradeInfo: tradeInfo,
                TradeSha: tradeSha,
                Version: NEWEBPAY_CONFIG.version,
                PaymentURL: NEWEBPAY_CONFIG.paymentURL
            }
        });

    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Payment Callback from Newebpay
app.post('/api/payment-callback', (req, res) => {
    try {
        console.log('Payment callback received:', req.body);

        const { Status, TradeInfo, TradeSha } = req.body;

        // Decrypt TradeInfo
        const decryptedData = aesDecrypt(TradeInfo, NEWEBPAY_CONFIG.hashKey, NEWEBPAY_CONFIG.hashIV);
        const paymentResult = JSON.parse(decryptedData);

        console.log('Payment result:', paymentResult);

        const orderId = paymentResult.Result.MerchantOrderNo;

        // Check if payment is successful
        if (paymentResult.Status === 'SUCCESS') {
            // Move result from pending to paid
            if (pendingResults.has(orderId)) {
                const orderData = pendingResults.get(orderId);
                paidResults.set(orderId, orderData);
                pendingResults.delete(orderId);
                console.log(`Payment successful for order: ${orderId}`);
            }
        }

        res.send('OK');

    } catch (error) {
        console.error('Payment callback error:', error);
        res.status(500).send('ERROR');
    }
});

// Payment Return URL Handler (for user redirection)
app.post('/api/payment-return', (req, res) => {
    try {
        console.log('Payment return received:', req.body);

        const { Status, TradeInfo, TradeSha } = req.body;

        // Decrypt TradeInfo to get order details
        const decryptedData = aesDecrypt(TradeInfo, NEWEBPAY_CONFIG.hashKey, NEWEBPAY_CONFIG.hashIV);
        const paymentResult = JSON.parse(decryptedData);

        console.log('Payment return result:', paymentResult);

        const orderId = paymentResult.Result.MerchantOrderNo;

        // Check if payment is successful and move to paid status
        if (paymentResult.Status === 'SUCCESS') {
            if (pendingResults.has(orderId)) {
                const orderData = pendingResults.get(orderId);
                paidResults.set(orderId, orderData);
                pendingResults.delete(orderId);
                console.log(`Payment successful for order: ${orderId}`);
            }
        }

        // Get frontend URL from environment variable
        const frontendURL = process.env.FRONTEND_URL || 'http://localhost:3000';

        // Redirect to frontend with orderId
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Payment Processing</title>
                <meta http-equiv="refresh" content="0;url=${frontendURL}/?orderId=${orderId}">
            </head>
            <body>
                <p>Processing payment... Redirecting...</p>
                <script>
                    window.location.href = '${frontendURL}/?orderId=${orderId}';
                </script>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Payment return error:', error);
        const frontendURL = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Payment Error</title>
            </head>
            <body>
                <p>Payment processing error. <a href="${frontendURL}">Return to homepage</a></p>
            </body>
            </html>
        `);
    }
});

// Get Analysis Result (only if paid)
app.get('/api/get-result/:orderId', (req, res) => {
    const { orderId } = req.params;

    if (paidResults.has(orderId)) {
        const orderData = paidResults.get(orderId);
        res.send(orderData.result);
    } else if (pendingResults.has(orderId)) {
        res.status(402).json({ error: 'Payment required' });
    } else {
        res.status(404).json({ error: 'Order not found' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Open your browser and go to http://localhost:${port}`);
});
