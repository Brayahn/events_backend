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
  const FormData = require('form-data');
  const form = new FormData();
  
  // Correct Monday.com file upload format
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
  
  // Map tells Monday which form field contains the file
  const map = {
    "image": ["variables.file"]
  };
  
  form.append('query', query);
  form.append('map', JSON.stringify(map));
  form.append('image', fileBuffer, {
    filename: fileName,
    contentType: 'image/png'
  });

  try {
    const response = await fetch("https://api.monday.com/v2/file", {
      method: "POST",
      headers: {
        "Authorization": MONDAY_API_KEY,
        ...form.getHeaders()
      },
      body: form
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error uploading file to Monday:', error);
    throw error;
  }
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

async function getBoardColumns(boardId) {
  const query = `
    query {
      boards(ids: [${boardId}]) {
        columns {
          id
          title
          type
        }
      }
    }
  `;

  try {
    const response = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": MONDAY_API_KEY
      },
      body: JSON.stringify({ query })
    });

    const data = await response.json();
    
    if (data.errors) {
      console.error('Error fetching board columns:', data.errors);
      return [];
    }

    return data?.data?.boards?.[0]?.columns || [];
  } catch (error) {
    console.error('Error fetching board columns:', error);
    return [];
  }
}

async function getMondayItemData(itemId) {
  const query = `
    query {
      items(ids: [${itemId}]) {
        id
        name
        board {
          id
        }
        column_values {
          id
          text
          type
          value
        }
      }
    }
  `;

  console.log('Making Monday API request for item:', itemId);
  
  try {
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 10000);
    });

    // Create the fetch promise
    const fetchPromise = fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": MONDAY_API_KEY
      },
      body: JSON.stringify({ query })
    });

    // Race between timeout and fetch
    const response = await Promise.race([fetchPromise, timeoutPromise]);

    console.log('Monday API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Monday API error response:', errorText);
      throw new Error(`Monday API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('Monday API response received');
    console.log('Has data:', !!data.data);
    console.log('Has items:', !!data.data?.items);

    if (data.errors) {
      console.error('Monday API GraphQL errors:', data.errors);
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    const item = data?.data?.items?.[0] || null;
    if (item) {
      console.log('Item found with', item.column_values?.length || 0, 'columns');
    } else {
      console.log('No item found in response');
    }

    return item;
  } catch (error) {
    console.error('Error fetching Monday item data:', error.message);
    throw error;
  }
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

    // Respond immediately to Monday to prevent retries
    // We'll process asynchronously
    res.status(200).json({
      success: true,
      message: "Processing webhook...",
      itemId,
      boardId
    });

    console.log('Response sent to Monday, continuing processing...');

    // Fetch the full item data from Monday API
    console.log('Fetching item data from Monday API...');
    
    let itemData;
    try {
      itemData = await getMondayItemData(itemId);
    } catch (fetchError) {
      console.error('Failed to fetch item data:', fetchError.message);
      // Response already sent, just log and return
      return;
    }
    
    if (!itemData) {
      console.error('Could not fetch item data from Monday');
      // Response already sent, just log and return
      return;
    }

    console.log('Item data fetched successfully');
    console.log('Columns:', itemData.column_values.map(c => ({ id: c.id, type: c.type, text: c.text })));

    // Fetch board columns to get column titles
    console.log('Fetching board columns to get titles...');
    const boardColumns = await getBoardColumns(boardId);
    console.log('Board columns:', boardColumns.map(c => ({ id: c.id, title: c.title, type: c.type })));

    // Create a map of column ID to title
    const columnTitleMap = {};
    boardColumns.forEach(col => {
      columnTitleMap[col.id] = col.title;
    });

    // Extract URL from column values
    // Look for the URL column (adjust the column name/id as needed)
    let longUrl = null;
    let urlColumnId = null;

    for (const column of itemData.column_values) {
      const columnTitle = columnTitleMap[column.id] || '';
      const columnText = column.text || '';
      
      console.log(`Checking column ${column.id} (${columnTitle}):`, {
        text: columnText,
        type: column.type,
        value: column.value
      });
      
      // Option 1: Check by column title containing "url"
      if (columnTitle.toLowerCase().includes('url') || columnTitle.toLowerCase().includes('paste long link')) {
        // For link columns, extract URL from JSON value
        if (column.type === 'link' && column.value) {
          try {
            const linkValue = JSON.parse(column.value);
            console.log('Parsed link value:', linkValue);
            longUrl = linkValue.url || linkValue.text;
            urlColumnId = column.id;
            console.log(`✓ Found URL in link column "${columnTitle}": ${longUrl}`);
            break;
          } catch (e) {
            console.log('Could not parse link value:', column.value);
          }
        } else if (columnText) {
          // For text columns, use the text directly
          longUrl = columnText;
          urlColumnId = column.id;
          console.log(`✓ Found URL by title "${columnTitle}": ${longUrl}`);
          break;
        }
      }
      
      // Option 2: Check if column type is 'link' and has a value
      if (column.type === 'link' && column.value) {
        try {
          const linkValue = JSON.parse(column.value);
          console.log('Link column value:', linkValue);
          const url = linkValue.url || linkValue.text;
          if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            longUrl = url;
            urlColumnId = column.id;
            console.log(`✓ Found URL in link column "${columnTitle}": ${longUrl}`);
            break;
          }
        } catch (e) {
          // Not a valid JSON
        }
      }
      
      // Option 3: Check if text looks like a URL
      if (columnText && (columnText.startsWith('http://') || columnText.startsWith('https://'))) {
        longUrl = columnText;
        urlColumnId = column.id;
        console.log(`✓ Found URL in text column "${columnTitle}": ${longUrl}`);
        break;
      }
    }

    // Fallback to direct parameters if URL not found
    if (!longUrl && req.body.url) {
      longUrl = req.body.url;
    }

    console.log(`Extracted URL: ${longUrl} from column: ${urlColumnId}`);

    if (!longUrl) {
      console.error('URL not found in item. Available columns:', itemData.column_values.map(c => {
        const title = columnTitleMap[c.id] || 'Unknown';
        return { id: c.id, title: title, text: c.text };
      }));
      // Response already sent, just log and return
      return;
    }

    // Validate URL format
    try {
      new URL(longUrl);
    } catch (error) {
      console.error('Invalid URL format:', longUrl);
      // Response already sent, just log and return
      return;
    }

    // Generate short code
    const customCode = req.body.customCode;
    let shortCode = customCode || generateShortCode();
    
    if (customCode && urlDatabase.has(customCode)) {
      console.error('Custom code already exists:', customCode);
      // Response already sent, just log and return
      return;
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
    // Find the "Shortened Link" column ID from board columns
    const shortenedLinkColumn = boardColumns.find(col => 
      col.title.toLowerCase().includes('shortened') || 
      col.title.toLowerCase().includes('short')
    );
    
    const shortenedLinkColumnId = shortenedLinkColumn?.id || 'link_mkm2xtks';
    
    console.log('Shortened Link column ID:', shortenedLinkColumnId);

    // For link columns, we need to set both url and text
    const columnUpdates = {
      [shortenedLinkColumnId]: JSON.stringify({
        url: shortUrl,
        text: shortUrl
      })
    };

    console.log('Updating Monday columns:', columnUpdates);
    
    const updateResult = await updateMondayColumns(itemId, boardId, columnUpdates);
    console.log('Monday update result:', JSON.stringify(updateResult, null, 2));

    // Upload QR code image to Monday.com
    // Find the "QR Code" column ID from board columns
    const qrCodeColumn = boardColumns.find(col => 
      col.title.toLowerCase().includes('qr') && col.type === 'file'
    );
    
    const qrColumnId = qrCodeColumn?.id || 'file_mkm2j36d';
    
    console.log(`Uploading QR code to column: ${qrColumnId}`);
    
    const uploadResult = await uploadFileToMonday(
      itemId,
      qrColumnId,
      qrBuffer,
      `qr-${shortCode}.png`
    );
    
    console.log('QR code upload result:', JSON.stringify(uploadResult, null, 2));

    console.log('✅ Successfully completed processing for item:', itemId);
    console.log(`Short URL: ${shortUrl}`);
    
  } catch (error) {
    console.error("Error in shorten-with-qr:", error);
    console.error("Stack trace:", error.stack);
    // Note: Response already sent, just log the error
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