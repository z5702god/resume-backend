const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fetch = require('node-fetch');
const FormData = require('form-data');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

// Configuration from Environment Variables
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://majestic-cactus-655cc9.netlify.app';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

const MerchantID = process.env.MerchantID || process.env.NEWEBPAY_MERCHANT_ID || 'MS157481566';
const HASHKEY = process.env.HASHKEY || process.env.NEWEBPAY_HASH_KEY || 'jKNxcpnMtZx2ygaBYKeaWdT0w4Usl9HZ';
const HASHIV = process.env.HASHIV || process.env.NEWEBPAY_HASH_IV || 'CAAevAsTggx5zG6P';
const Version = process.env.Version || '2.0';
const PayGateWay = process.env.PayGateWay || process.env.NEWEBPAY_URL || 'https://ccore.newebpay.com/MPG/mpg_gateway';
const NotifyUrl = process.env.NotifyUrl || `${BACKEND_URL}/api/payment-callback`;
const ReturnUrl = process.env.ReturnUrl || `${BACKEND_URL}/api/payment-return`;
const RespondType = 'JSON';

// Debug: Log configuration on startup
console.log('=== Newebpay Configuration ===');
console.log('MerchantID:', MerchantID);
console.log('HASHKEY:', HASHKEY ? `${HASHKEY.substring(0, 10)}...` : 'NOT SET');
console.log('HASHIV:', HASHIV ? `${HASHIV.substring(0, 10)}...` : 'NOT SET');
console.log('PayGateWay:', PayGateWay);
console.log('BACKEND_URL:', BACKEND_URL);
console.log('FRONTEND_URL:', FRONTEND_URL);
console.log('NotifyUrl:', NotifyUrl);
console.log('ReturnUrl:', ReturnUrl);
console.log('==============================');

// Enable CORS - Permissive for testing
app.use(cors());

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure Multer for file upload
const upload = multer({ storage: multer.memoryStorage() });

// In-memory storage
const pendingResults = new Map();
const paidResults = new Map();

// --- Helper Functions ---

function genDataChain(order) {
    return `MerchantID=${MerchantID}&TimeStamp=${order.TimeStamp}&Version=${Version}&RespondType=${RespondType}&MerchantOrderNo=${order.MerchantOrderNo}&Amt=${order.Amt}&NotifyURL=${encodeURIComponent(NotifyUrl)}&ReturnURL=${encodeURIComponent(ReturnUrl)}&ItemDesc=${encodeURIComponent(order.ItemDesc)}&Email=${encodeURIComponent(order.Email)}`;
}

function createSesEncrypt(TradeInfo) {
    const encrypt = crypto.createCipheriv('aes-256-cbc', HASHKEY, HASHIV);
    const enc = encrypt.update(genDataChain(TradeInfo), 'utf8', 'hex');
    return enc + encrypt.final('hex');
}

function createShaEncrypt(aesEncrypt) {
    const sha = crypto.createHash('sha256');
    const plainText = `HashKey=${HASHKEY}&${aesEncrypt}&HashIV=${HASHIV}`;
    return sha.update(plainText).digest('hex').toUpperCase();
}

function createSesDecrypt(TradeInfo) {
    const decrypt = crypto.createDecipheriv('aes-256-cbc', HASHKEY, HASHIV);
    decrypt.setAutoPadding(false);
    const text = decrypt.update(TradeInfo, 'hex', 'utf8');
    const plainText = text + decrypt.final('utf8');
    const result = plainText.replace(/[\x00-\x20]+/g, '');
    return JSON.parse(result);
}

// --- API Endpoints ---

app.post('/api/analyze', upload.single('resume'), async (req, res) => {
    console.log('Received analysis request');
    try {
        if (!req.file) return res.status(400).json({ error: 'No resume file uploaded' });

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

        const responseText = await response.text();
        if (!response.ok) return res.status(response.status).send(responseText);

        const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        pendingResults.set(orderId, {
            result: responseText,
            userId: req.body.userId,
            timestamp: new Date()
        });

        res.json({ success: true, orderId: orderId, message: 'Analysis complete. Please proceed to payment.' });
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/create-order', async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!pendingResults.has(orderId)) return res.status(404).json({ error: 'Order not found' });

        const orderData = pendingResults.get(orderId);
        const TimeStamp = Math.round(new Date().getTime() / 1000);

        const order = {
            TimeStamp,
            MerchantOrderNo: orderId,
            Amt: 100,
            ItemDesc: '履歷透視鏡分析服務',
            Email: orderData.userId || 'test@example.com'
        };

        const tradeInfoString = genDataChain(order);
        console.log('=== Creating Payment Order ===');
        console.log('Order ID:', orderId);
        console.log('TradeInfo String:', tradeInfoString);
        console.log('==============================');

        const aesEncrypt = createSesEncrypt(order);
        const shaEncrypt = createShaEncrypt(aesEncrypt);

        res.json({
            success: true,
            paymentData: {
                MerchantID: MerchantID,
                TradeInfo: aesEncrypt,
                TradeSha: shaEncrypt,
                Version: Version,
                PaymentURL: PayGateWay
            }
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/payment-callback', (req, res) => {
    try {
        console.log('Payment callback received:', req.body);
        const { TradeInfo, TradeSha } = req.body;

        const thisShaEncrypt = createShaEncrypt(TradeInfo);
        if (thisShaEncrypt !== TradeSha) {
            console.log('付款失敗：TradeSha 不一致');
            return res.end();
        }

        const data = createSesDecrypt(TradeInfo);
        console.log('Decrypted data:', data);

        const orderId = data.Result.MerchantOrderNo;
        if (data.Status === 'SUCCESS' && pendingResults.has(orderId)) {
            const orderData = pendingResults.get(orderId);
            paidResults.set(orderId, orderData);
            pendingResults.delete(orderId);
            console.log(`Payment successful for order: ${orderId}`);
        }

        res.send('OK');
    } catch (error) {
        console.error('Payment callback error:', error);
        res.status(500).send('ERROR');
    }
});

app.post('/api/payment-return', (req, res) => {
    try {
        console.log('Payment return received:', req.body);
        const { TradeInfo } = req.body;

        const data = createSesDecrypt(TradeInfo);
        console.log('Decrypted return data:', data);

        const orderId = data.Result.MerchantOrderNo;
        if (data.Status === 'SUCCESS' && pendingResults.has(orderId)) {
            const orderData = pendingResults.get(orderId);
            paidResults.set(orderId, orderData);
            pendingResults.delete(orderId);
        }

        const redirectUrl = `${FRONTEND_URL}/?orderId=${orderId}`;
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><meta http-equiv="refresh" content="0;url=${redirectUrl}"></head>
            <body><script>window.location.href = '${redirectUrl}';</script></body>
            </html>
        `);
    } catch (error) {
        console.error('Payment return error:', error);
        res.send('Payment processing error');
    }
});

app.get('/api/get-result/:orderId', (req, res) => {
    const { orderId } = req.params;
    if (paidResults.has(orderId)) {
        res.send(paidResults.get(orderId).result);
    } else if (pendingResults.has(orderId)) {
        res.status(402).json({ error: 'Payment required' });
    } else {
        res.status(404).json({ error: 'Order not found' });
    }
});

app.listen(port, () => {
    console.log(`Backend Server running at http://localhost:${port}`);
});
