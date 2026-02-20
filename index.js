const express = require('express');
const fetch = require('node-fetch');
const QRCode = require('qrcode');
const crypto = require('crypto');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  if (req.body && req.body.challenge) {
    return res.status(200).json({
      challenge: req.body.challenge
    });
  }
  next();
});

const PORT = process.env.PORT || 3000;
const MONDAY_API_KEY = process.env.MONDAY_API_KEY || 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjMzMzg0NDUzNiwiYWFpIjoxMSwidWlkIjo1NzI1NDM4OSwiaWFkIjoiMjAyNC0wMy0xNlQxOTo1MTo1My4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTQ5Mjc2NzgsInJnbiI6InVzZTEifQ.GzG-PARLDqJnQBQkff9Nj95pWdbc9CTRziyF4QdFNH4';

// In-memory storage for shortened URLs (use database in production)
const urlDatabase = new Map();

// ==================== HELPER FUNCTIONS ====================

// Generate short code
function generateShortCode(length = 6) {
  return crypto.randomBytes(length).toString('base64url').substring(0, length);
}

// Update Monday.com column values
async function updateMondayColumns(itemId, boardId, columnValues) {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(
        board_id: $boardId,
        item_id: $itemId,
        column_values: $columnValues
      ) {
        id
      }
    }
  `;

  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": MONDAY_API_KEY
    },
    body: JSON.stringify({
      query,
      variables: {
        boardId: boardId.toString(),
        itemId: itemId.toString(),
        columnValues: JSON.stringify(columnValues)
      }
    })
  });

  return await response.json();
}

// Upload file to Monday.com
async function uploadFileToMonday(itemId, columnId, fileBuffer, fileName) {
  const query = `
    mutation ($file: File!) {
      add_file_to_column (
        item_id: ${itemId},
        column_id: "${columnId}",
        file: $file
      ) {
        id
      }
    }
  `;

  // Create form data
  const FormData = require('form-data');
  const form = new FormData();
  
  form.append('query', query);
  form.append('variables[file]', fileBuffer, {
    filename: fileName,
    contentType: 'image/png'
  });

  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Authorization": MONDAY_API_KEY,
      ...form.getHeaders()
    },
    body: form
  });

  return await response.json();
}

// ==================== MONDAY WEBHOOK ====================
app.post('/webhook/monday', async (req, res) => {
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  // Monday verification challenge
  if (req.body.challenge) {
    return res.status(200).json({
      challenge: req.body.challenge
    });
  }
  
  try {
    // 🔹 Extract values from webhook - Use pulseName as board name
    const boardName = req.body.event?.pulseName || "New Auto Board";
    const workspaceId = req.body.event?.workspaceId || '14192369';
    const folderId = req.body.event?.folderId || '19465689';
    const templateId = '16165057'; // Template ID to use
    
    console.log(`Creating board with name: "${boardName}" from template: ${templateId}`);
    
    if (!workspaceId || !folderId) {
      return res.status(400).json({
        success: false,
        message: "workspaceId and folderId are required"
      });
    }
    
    const query = `
      mutation ($boardName: String!, $workspaceId: ID!, $folderId: ID!, $templateId: ID!) {
        create_board (
          board_name: $boardName,
          board_kind: public,
          workspace_id: $workspaceId,
          folder_id: $folderId,
          template_id: $templateId
        ) {
          id
          name
        }
      }
    `;
    
    const response = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": MONDAY_API_KEY
      },
      body: JSON.stringify({
        query,
        variables: {
          boardName,
          workspaceId,
          folderId,
          templateId
        }
      })
    });
    
    const data = await response.json();
    console.log("Board created from template:", data);
    
    return res.status(200).json({
      success: true,
      createdBoard: data
    });
    
  } catch (error) {
    console.error("Error creating board:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== URL SHORTENER ====================

// Shorten URL
app.post('/api/shorten', async (req, res) => {
  try {
    const { url, customCode } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: "URL is required"
      });
    }
    
    // Validate URL format
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid URL format"
      });
    }
    
    // Generate or use custom short code
    let shortCode = customCode || generateShortCode();
    
    // Check if custom code already exists
    if (customCode && urlDatabase.has(customCode)) {
      return res.status(400).json({
        success: false,
        message: "Custom code already exists"
      });
    }
    
    // Store in database
    urlDatabase.set(shortCode, {
      originalUrl: url,
      shortCode,
      createdAt: new Date().toISOString(),
      clicks: 0
    });
    
    const shortUrl = `${req.protocol}://${req.get('host')}/s/${shortCode}`;
    
    return res.status(200).json({
      success: true,
      originalUrl: url,
      shortUrl,
      shortCode
    });
    
  } catch (error) {
    console.error("Error shortening URL:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Redirect shortened URL
app.get('/s/:shortCode', (req, res) => {
  const { shortCode } = req.params;
  
  const urlData = urlDatabase.get(shortCode);
  
  if (!urlData) {
    return res.status(404).json({
      success: false,
      message: "Short URL not found"
    });
  }
  
  // Increment click counter
  urlData.clicks++;
  
  // Redirect to original URL
  return res.redirect(urlData.originalUrl);
});

// ==================== QR CODE GENERATOR ====================

// Generate QR code for a URL
app.post('/api/qrcode', async (req, res) => {
  try {
    const { url, format = 'png', size = 300 } = req.body;
  
    // Monday verification challenge
    if (req.body.challenge) {
      return res.status(200).json({
        challenge: req.body.challenge
      });
    }
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: "URL is required"
      });
    }
    
    // Validate URL
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid URL format"
      });
    }
    
    // Generate QR code options
    const options = {
      width: size,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    };
    
    if (format === 'svg') {
      // Generate SVG QR code
      const qrSvg = await QRCode.toString(url, { ...options, type: 'svg' });
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(qrSvg);
    } else {
      // Generate PNG QR code (default)
      const qrPng = await QRCode.toBuffer(url, options);
      res.setHeader('Content-Type', 'image/png');
      return res.send(qrPng);
    }
    
  } catch (error) {
    console.error("Error generating QR code:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Generate QR code as base64 data URL (useful for embedding)
app.post('/api/qrcode/base64', async (req, res) => {
  try {
    const { url, size = 300 } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: "URL is required"
      });
    }
    
    // Validate URL
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid URL format"
      });
    }
    
    const options = {
      width: size,
      margin: 1
    };
    
    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(url, options);
    
    return res.status(200).json({
      success: true,
      url,
      qrCode: qrDataUrl
    });
    
  } catch (error) {
    console.error("Error generating QR code:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== HELPER: FETCH ITEM DATA FROM MONDAY ====================

async function getMondayItemData(itemId) {
  const query = `
    query {
      items(ids: ${itemId}) {
        id
        name
        board {
          id
        }
        column_values {
          id
          title
          text
          type
          value
        }
      }
    }
  `;

  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": MONDAY_API_KEY
    },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  return data?.data?.items?.[0] || null;
}

// ==================== COMBINED: SHORTEN + QR CODE (WITH MONDAY WEBHOOK) ====================

// Shorten URL and generate QR code in one request
// This endpoint receives Monday.com webhooks and updates the board
app.post('/api/shorten-with-qr', async (req, res) => {
  console.log('Shorten-with-QR webhook received:', JSON.stringify(req.body, null, 2));

  // Monday verification challenge
  if (req.body.challenge) {
    return res.status(200).json({
      challenge: req.body.challenge
    });
  }

  try {
    // Extract data from Monday webhook
    const event = req.body.event;
    const itemId = event?.pulseId;
    const boardId = event?.boardId;

    if (!itemId || !boardId) {
      return res.status(400).json({
        success: false,
        message: "Monday webhook missing itemId or boardId"
      });
    }

    console.log(`Webhook for Item: ${itemId}, Board: ${boardId}`);

    // Fetch the full item data from Monday API
    console.log('Fetching item data from Monday API...');
    const itemData = await getMondayItemData(itemId);
    
    if (!itemData) {
      return res.status(404).json({
        success: false,
        message: "Could not fetch item data from Monday"
      });
    }

    console.log('Item data fetched:', JSON.stringify(itemData, null, 2));

    // Extract URL from column values
    // Look for the URL column (adjust the column name/id as needed)
    let longUrl = null;
    let urlColumnId = null;

    for (const column of itemData.column_values) {
      // Check if this is the URL column by title or if it contains a URL
      const columnText = column.text || '';
      
      // Option 1: Check by column title
      if (column.title && column.title.toLowerCase().includes('url')) {
        longUrl = columnText;
        urlColumnId = column.id;
        console.log(`Found URL by title "${column.title}": ${longUrl}`);
        break;
      }
      
      // Option 2: Check if column type is 'link'
      if (column.type === 'link' && column.value) {
        try {
          const linkValue = JSON.parse(column.value);
          longUrl = linkValue.url || linkValue.text;
          urlColumnId = column.id;
          console.log(`Found URL in link column "${column.title}": ${longUrl}`);
          break;
        } catch (e) {
          // Not a valid JSON
        }
      }
      
      // Option 3: Check if text looks like a URL
      if (columnText && (columnText.startsWith('http://') || columnText.startsWith('https://'))) {
        longUrl = columnText;
        urlColumnId = column.id;
        console.log(`Found URL in text column "${column.title}": ${longUrl}`);
        break;
      }
    }

    // Fallback to direct parameters if URL not found
    if (!longUrl && req.body.url) {
      longUrl = req.body.url;
    }

    console.log(`Extracted URL: ${longUrl} from column: ${urlColumnId}`);

    if (!longUrl) {
      return res.status(400).json({
        success: false,
        message: "URL not found in item. Please paste a URL in the 'Paste Long Link' column.",
        itemData: itemData.column_values.map(c => ({ id: c.id, title: c.title, text: c.text }))
      });
    }

    // Validate URL format
    try {
      new URL(longUrl);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid URL format. Please include https://"
      });
    }

    // Generate short code
    const customCode = req.body.customCode;
    let shortCode = customCode || generateShortCode();
    
    if (customCode && urlDatabase.has(customCode)) {
      return res.status(400).json({
        success: false,
        message: "Custom code already exists"
      });
    }

    // Store in database
    urlDatabase.set(shortCode, {
      originalUrl: longUrl,
      shortCode,
      createdAt: new Date().toISOString(),
      clicks: 0
    });

    const shortUrl = `${req.protocol}://${req.get('host')}/s/${shortCode}`;
    
    // Generate QR code for the shortened URL
    const qrSize = req.body.qrSize || 500;
    const qrOptions = {
      width: qrSize,
      margin: 1
    };
    
    const qrBuffer = await QRCode.toBuffer(shortUrl, qrOptions);
    
    console.log(`Generated - Short URL: ${shortUrl}, QR Code size: ${qrBuffer.length} bytes`);

    // Update Monday.com board with shortened URL
    // Update the "Shortened Link" column with the short URL
    const columnUpdates = {
      // Replace 'text8' with your actual column ID for "Shortened Link"
      // You can find column IDs in Monday.com board settings
      text8: shortUrl  // Update this column ID to match your board
    };

    console.log('Updating Monday columns:', columnUpdates);
    
    const updateResult = await updateMondayColumns(itemId, boardId, columnUpdates);
    console.log('Monday update result:', JSON.stringify(updateResult, null, 2));

    // Upload QR code image to Monday.com
    // Replace 'file' with your actual column ID for "QR Code"
    const qrColumnId = 'file';  // Update this column ID to match your board
    
    console.log(`Uploading QR code to column: ${qrColumnId}`);
    
    const uploadResult = await uploadFileToMonday(
      itemId,
      qrColumnId,
      qrBuffer,
      `qr-${shortCode}.png`
    );
    
    console.log('QR code upload result:', JSON.stringify(uploadResult, null, 2));

    return res.status(200).json({
      success: true,
      originalUrl: longUrl,
      shortUrl,
      shortCode,
      itemId,
      boardId,
      mondayUpdateResult: updateResult,
      qrUploadResult: uploadResult,
      message: "Short URL and QR code have been added to your Monday board!"
    });
    
  } catch (error) {
    console.error("Error in shorten-with-qr:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// ==================== URL STATS ====================

// Get stats for a shortened URL
app.get('/api/stats/:shortCode', (req, res) => {
  const { shortCode } = req.params;
  
  const urlData = urlDatabase.get(shortCode);
  
  if (!urlData) {
    return res.status(404).json({
      success: false,
      message: "Short URL not found"
    });
  }
  
  return res.status(200).json({
    success: true,
    data: urlData
  });
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    urlCount: urlDatabase.size
  });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Monday webhook ready at: http://localhost:${PORT}/api/shorten-with-qr`);
});