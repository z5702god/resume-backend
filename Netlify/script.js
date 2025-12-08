// Configuration
// Change this to your Zeabur Backend URL for production
// e.g., const BACKEND_URL = 'https://lukebackend.zeabur.app';
const BACKEND_URL = 'https://lukebackend.zeabur.app';

// Page navigation
const landingPage = document.getElementById('landingPage');
const analysisPage = document.getElementById('analysisPage');
const startAnalysisBtn = document.getElementById('startAnalysisBtn');

// DOM Elements
const form = document.getElementById('analysisForm');
const resumeInput = document.getElementById('resume');
const dropArea = document.getElementById('dropArea');
const fileNameDisplay = document.getElementById('fileName');
const submitBtn = document.getElementById('submitBtn');
const paymentSection = document.getElementById('paymentSection');
const paymentBtn = document.getElementById('paymentBtn');
const orderIdDisplay = document.getElementById('orderIdDisplay');
const resultSection = document.getElementById('resultSection');
const resetBtn = document.getElementById('resetBtn');
const scoreValue = document.getElementById('scoreValue');
const reviewContent = document.getElementById('reviewContent');

// Payment form elements
const newebpayForm = document.getElementById('newebpayForm');
const merchantIDInput = document.getElementById('MerchantID');
const tradeInfoInput = document.getElementById('TradeInfo');
const tradeShaInput = document.getElementById('TradeSha');
const versionInput = document.getElementById('Version');

// File Upload Handling
let selectedFile = null;
let currentOrderId = null;

// Page Navigation Handler
startAnalysisBtn.addEventListener('click', () => {
    landingPage.classList.add('hidden');
    analysisPage.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Back Button Handler
const backBtn = document.getElementById('backBtn');
backBtn.addEventListener('click', () => {
    analysisPage.classList.add('hidden');
    landingPage.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
});


// Fetch and Display Payment Result
async function fetchPaymentResult(orderId) {
    try {
        console.log('Fetching payment result for orderId:', orderId);

        // Show analysis page (not landing page)
        landingPage.classList.add('hidden');
        analysisPage.classList.remove('hidden');

        // Fetch full results from backend
        const response = await fetch(`${BACKEND_URL}/api/get-result/${orderId}`);

        if (response.status === 402) {
            alert('付款尚未完成，請先完成付款');
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to fetch results');
        }

        const responseText = await response.text();
        const data = JSON.parse(responseText);

        // Display full results
        const score = data[0]?.score || data[0]?.Score || 0;
        const review = data[0]?.overallReview || data[0]?.['Overall Review'] || '';

        // Show score with animation
        scoreValue.textContent = '0';
        setTimeout(() => {
            let current = 0;
            const target = parseInt(score);
            const increment = target / 20;
            const timer = setInterval(() => {
                current += increment;
                if (current >= target) {
                    scoreValue.textContent = target;
                    clearInterval(timer);
                } else {
                    scoreValue.textContent = Math.floor(current);
                }
            }, 50);
        }, 300);

        // Display review content
        if (typeof marked !== 'undefined') {
            reviewContent.innerHTML = marked.parse(review);
        } else {
            reviewContent.innerHTML = review.replace(/\n/g, '<br>');
        }

        // Hide payment section and show results
        paymentSection.classList.add('hidden');
        resultSection.classList.remove('hidden');

        // Scroll to results
        resultSection.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        console.error('Error fetching payment result:', error);
        alert('獲取分析結果時發生錯誤');
    }
}

// Check if returning from payment
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('orderId');

    if (orderId) {
        console.log('Returning from payment with orderId:', orderId);
        currentOrderId = orderId;

        // IMMEDIATELY show analysis page and hide landing page
        if (landingPage) landingPage.classList.add('hidden');
        if (analysisPage) analysisPage.classList.remove('hidden');

        // Then fetch and display results
        fetchPaymentResult(orderId);
    }
});

// Drag and Drop Events
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => {
        dropArea.classList.add('highlight');
    }, false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => {
        dropArea.classList.remove('highlight');
    }, false);
});

dropArea.addEventListener('drop', handleDrop, false);

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files.length > 0) {
        resumeInput.files = files;
        handleFileSelect({ target: resumeInput });
    }
}

// Click to Upload
dropArea.addEventListener('click', (e) => {
    if (e.target === resumeInput) {
        return;
    }
    e.preventDefault();
    resumeInput.click();
});

resumeInput.addEventListener('click', (e) => {
    e.stopPropagation();
});

resumeInput.addEventListener('change', handleFileSelect);

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        if (file.type !== 'application/pdf') {
            alert('Please upload a PDF file');
            resumeInput.value = '';
            fileNameDisplay.textContent = '';
            selectedFile = null;
            return;
        }
        selectedFile = file;
        fileNameDisplay.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
    }
}

// Form Submission - Modified for Payment Flow
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!selectedFile) {
        alert('Please select a PDF file');
        return;
    }

    // Show loading state
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    paymentSection.classList.add('hidden');
    resultSection.classList.add('hidden');

    try {
        // Prepare FormData
        const formData = new FormData();
        formData.append('userId', document.getElementById('userId').value);
        formData.append('jobResponsibilities', document.getElementById('jobResponsibilities').value);
        formData.append('jobRequirements', document.getElementById('jobRequirements').value);
        formData.append('resume', selectedFile);

        console.log('Sending request to analyze...');

        console.log('Sending request to analyze...');

        const response = await fetch(`${BACKEND_URL}/api/analyze`, {
            method: 'POST',
            body: formData
        });

        console.log('Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('Analysis result:', result);

        if (result.success && result.orderId) {
            currentOrderId = result.orderId;

            // Show preview of results (first 3 lines) before payment
            if (result.preview) {
                showPreview(result.preview, result.orderId);
            } else {
                // Fallback: just show payment section
                showPaymentSection(result.orderId);
            }
        } else {
            throw new Error('Invalid response from server');
        }

    } catch (error) {
        console.error('Error:', error);
        alert(`Error analyzing resume: ${error.message}`);
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
});

// Show Preview (First 3 Lines) with Payment Button
function showPreview(previewText, orderId) {
    // Extract first 3 lines
    const lines = previewText.split('\n').filter(line => line.trim() !== '');
    const preview = lines.slice(0, 3).join('\n');

    // Display preview in review content
    if (typeof marked !== 'undefined') {
        reviewContent.innerHTML = marked.parse(preview) + '<div class="preview-blur"><p>🔒 完整分析內容已鎖定，請完成付款以解鎖</p></div>';
    } else {
        reviewContent.innerHTML = preview.replace(/\n/g, '<br>') + '<div class="preview-blur"><p>🔒 完整分析內容已鎖定，請完成付款以解鎖</p></div>';
    }

    // Show score as ? initially
    scoreValue.textContent = '?';

    // Show both result section (with preview) and payment section
    resultSection.classList.remove('hidden');
    paymentSection.classList.remove('hidden');
    orderIdDisplay.textContent = orderId;

    // Scroll to results
    resultSection.scrollIntoView({ behavior: 'smooth' });
}

// Show Payment Section
function showPaymentSection(orderId) {
    orderIdDisplay.textContent = orderId;
    paymentSection.classList.remove('hidden');
    paymentSection.scrollIntoView({ behavior: 'smooth' });
}

// Discount Code Variables
let appliedDiscountCode = null;
let discountedAmount = 100; // Default price

// Apply Discount Code
const applyDiscountBtn = document.getElementById('applyDiscountBtn');
const discountCodeInput = document.getElementById('discountCode');
const discountMessage = document.getElementById('discountMessage');
const discountRow = document.getElementById('discountRow');
const discountAmountDisplay = document.getElementById('discountAmount');
const finalAmountDisplay = document.getElementById('finalAmount');

applyDiscountBtn.addEventListener('click', () => {
    const code = discountCodeInput.value.trim().toUpperCase();

    if (!code) {
        discountMessage.textContent = '請輸入折扣碼';
        discountMessage.className = 'discount-message error';
        return;
    }

    // Validate discount code (client-side preview, server will validate again)
    if (code === 'JOYFU05') {
        appliedDiscountCode = code;
        const originalPrice = 100;
        const discount = 15; // 15 NTD discount (85折 = 100 - 15)
        discountedAmount = originalPrice - discount;

        // Update UI
        discountAmountDisplay.textContent = `- NT$ ${discount}`;
        finalAmountDisplay.textContent = `NT$ ${discountedAmount}`;
        discountRow.classList.remove('hidden');

        discountMessage.textContent = '✓ 折扣碼已套用！85折優惠';
        discountMessage.className = 'discount-message success';

        // Disable input after successful application
        discountCodeInput.disabled = true;
        applyDiscountBtn.disabled = true;
    } else {
        appliedDiscountCode = null;
        discountedAmount = 100;

        discountMessage.textContent = '✗ 無效的折扣碼';
        discountMessage.className = 'discount-message error';

        // Reset UI
        discountRow.classList.add('hidden');
        finalAmountDisplay.textContent = 'NT$ 100';
    }
});

// Payment Button Click
paymentBtn.addEventListener('click', async () => {
    try {
        paymentBtn.disabled = true;

        console.log('Creating payment order...');

        const response = await fetch(`${BACKEND_URL}/api/create-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                orderId: currentOrderId,
                discountCode: appliedDiscountCode // Send discount code to backend
            })
        });

        if (!response.ok) {
            throw new Error('Failed to create payment order');
        }

        const result = await response.json();
        console.log('Payment data:', result);

        if (result.success && result.paymentData) {
            // Fill the Newebpay form
            newebpayForm.action = result.paymentData.PaymentURL;
            merchantIDInput.value = result.paymentData.MerchantID;
            tradeInfoInput.value = result.paymentData.TradeInfo;
            tradeShaInput.value = result.paymentData.TradeSha;
            versionInput.value = result.paymentData.Version;

            // Submit the form to Newebpay
            console.log('Submitting to Newebpay...');
            newebpayForm.submit();
        } else {
            throw new Error('Invalid payment data');
        }

    } catch (error) {
        console.error('Payment error:', error);
        alert(`Payment error: ${error.message}`);
        paymentBtn.disabled = false;
    }
});

// Fetch Payment Result
async function fetchPaymentResult(orderId) {
    try {
        console.log('Fetching result for orderId:', orderId);

        const response = await fetch(`${BACKEND_URL}/api/get-result/${orderId}`);

        if (response.status === 402) {
            // Payment not completed yet
            alert('付款尚未完成，請先完成付款');
            showPaymentSection(orderId);
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to fetch result');
        }

        const responseText = await response.text();
        console.log('Result text:', responseText);

        // Parse and display results
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (parseError) {
            result = { rawResponse: responseText };
        }

        displayResults(result);

    } catch (error) {
        console.error('Error fetching result:', error);
        alert(`Error: ${error.message}`);
    }
}

function displayResults(data) {
    console.log('Raw data received:', data);

    // Check if data is an array and extract the first element
    let actualData = data;
    if (Array.isArray(data) && data.length > 0) {
        actualData = data[0];
        console.log('Extracted first element from array:', actualData);
    }

    // Extract score and review from the response
    let score = 0;
    let review = '';

    // Try different possible field names for score
    if (actualData.matchingScore !== undefined) {
        score = actualData.matchingScore;
    } else if (actualData.score !== undefined) {
        score = actualData.score;
    } else if (actualData['Rating Score'] !== undefined) {
        score = actualData['Rating Score'];
    } else if (actualData.ratingScore !== undefined) {
        score = actualData.ratingScore;
    }

    // Try different possible field names for review
    if (actualData.overallReview) {
        review = actualData.overallReview;
    } else if (actualData.review) {
        review = actualData.review;
    } else if (actualData['Overall Review']) {
        review = actualData['Overall Review'];
    } else if (actualData.rawResponse) {
        // Try to extract from raw text
        const lines = actualData.rawResponse.split('\n');
        for (let line of lines) {
            if (line.toLowerCase().includes('rating') || line.toLowerCase().includes('score')) {
                const match = line.match(/(\d+\.?\d*)/);
                if (match) score = parseFloat(match[1]);
            }
        }
        review = actualData.rawResponse;
    }

    console.log('Parsed score:', score);
    console.log('Parsed review:', review);

    // Remove matching score prefix from review if it exists
    review = review.replace(/^總體匹配度\s*[：:]\s*\d+\/\d+\s*[°。]?\s*/i, '');
    review = review.replace(/^匹配度\s*[：:]\s*\d+\/\d+\s*[°。]?\s*/i, '');

    // Display score with animation
    animateScore(score);

    // Display review (with markdown support)
    if (typeof marked !== 'undefined') {
        reviewContent.innerHTML = marked.parse(review);
    } else {
        reviewContent.innerHTML = review.replace(/\n/g, '<br>');
    }

    // Hide payment section and show result section
    paymentSection.classList.add('hidden');
    resultSection.classList.remove('hidden');
    resultSection.scrollIntoView({ behavior: 'smooth' });
}

function animateScore(targetScore) {
    let current = 0;
    const increment = targetScore / 50;
    const timer = setInterval(() => {
        current += increment;
        if (current >= targetScore) {
            current = targetScore;
            clearInterval(timer);
        }
        scoreValue.textContent = current.toFixed(1);
    }, 20);
}

// Reset button
resetBtn.addEventListener('click', () => {
    form.reset();
    selectedFile = null;
    fileNameDisplay.textContent = '';
    currentOrderId = null;
    paymentSection.classList.add('hidden');
    resultSection.classList.add('hidden');
    window.history.replaceState({}, document.title, window.location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
});
