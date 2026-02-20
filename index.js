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

const urlDatabase = new Map();

function generateShortCode(length = 6) {
  return crypto.randomBytes(length).toString('base64url').substring(0, length);
}

function logDivider() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}


// ==================== UPDATE MONDAY COLUMNS ====================
async function updateMondayColumns(itemId, boardId, columnValues) {
  logDivider();
  console.log("📤 Updating Monday Columns");
  console.log("Item ID:", itemId);
  console.log("Board ID:", boardId);
  console.log("Column Values:", JSON.stringify(columnValues, null, 2));

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

  try {
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

    console.log("📡 Status:", response.status);

    const result = await response.json();
    console.log("📥 Response:", JSON.stringify(result, null, 2));

    if (result.errors) {
      console.error("❌ GraphQL Errors:", result.errors);
    } else {
      console.log("✅ Column update successful");
    }

    logDivider();
    return result;

  } catch (error) {
    console.error("🔥 updateMondayColumns Error:", error);
    throw error;
  }
}


// ==================== UPLOAD FILE ====================
async function uploadFileToMonday(itemId, columnId, fileBuffer, fileName) {
  logDivider();
  console.log("📤 Uploading File to Monday");
  console.log("Item:", itemId);
  console.log("Column:", columnId);
  console.log("File:", fileName);
  console.log("Size:", fileBuffer.length, "bytes");

  const FormData = require('form-data');
  const form = new FormData();

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

  const map = { "file": ["variables.file"] };

  form.append('query', query);
  form.append('map', JSON.stringify(map));
  form.append('file', fileBuffer, {
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

    console.log("📡 Upload Status:", response.status);

    const result = await response.json();
    console.log("📥 Upload Response:", JSON.stringify(result, null, 2));

    if (result.errors) {
      console.error("❌ Upload Errors:", result.errors);
    } else {
      console.log("✅ File uploaded successfully");
    }

    logDivider();
    return result;

  } catch (error) {
    console.error("🔥 uploadFileToMonday Error:", error);
    throw error;
  }
}


// ==================== FETCH ITEM ====================
async function getMondayItemData(itemId) {
  logDivider();
  console.log("📤 Fetching Item:", itemId);

  const query = `
    query {
      items(ids: [${itemId}]) {
        id
        column_values {
          id
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

  console.log("📡 Fetch Status:", response.status);

  const data = await response.json();
  console.log("📥 Fetch Response:", JSON.stringify(data, null, 2));

  if (data.errors) {
    console.error("❌ Fetch Errors:", data.errors);
  }

  logDivider();
  return data?.data?.items?.[0] || null;
}


// ==================== FETCH BOARD COLUMNS ====================
async function getBoardColumns(boardId) {
  logDivider();
  console.log("📤 Fetching Board Columns:", boardId);

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

  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": MONDAY_API_KEY
    },
    body: JSON.stringify({ query })
  });

  console.log("📡 Board Fetch Status:", response.status);

  const data = await response.json();
  console.log("📥 Board Columns Response:", JSON.stringify(data, null, 2));

  if (data.errors) {
    console.error("❌ Board Errors:", data.errors);
  }

  logDivider();
  return data?.data?.boards?.[0]?.columns || [];
}


// ==================== MONDAY WEBHOOK ====================
app.post('/webhook/monday', async (req, res) => {
  console.log('📨 Webhook received:', JSON.stringify(req.body, null, 2));
  
  // Monday verification challenge
  if (req.body.challenge) {
    return res.status(200).json({
      challenge: req.body.challenge
    });
  }
  
  try {
    // Extract values from webhook
    const boardName = req.body.event?.pulseName || "New Auto Board";
    const workspaceId = req.body.event?.workspaceId || '14192369';
    const folderId = req.body.event?.folderId || '19465689';
    const templateId = '16165057';
    
    console.log(`📋 Creating board: "${boardName}" from template: ${templateId}`);
    
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
    console.log("📊 Board creation result:", JSON.stringify(data, null, 2));
    
    // ✅ Update status after successful board creation
    if (data?.data?.create_board?.id) {
      console.log('✅ Board created successfully! ID:', data.data.create_board.id);
      console.log('📝 Updating status to "Board and form generated"...');
      
      const webhookItemId = req.body.event?.pulseId;
      const webhookBoardId = req.body.event?.boardId;
      
      if (webhookItemId && webhookBoardId) {
        try {
          const boardColumns = await getBoardColumns(webhookBoardId);
          
          const statusColumn = boardColumns.find(col => 
            col.title.toLowerCase() === 'status' && col.type === 'status'
          );
          
          if (statusColumn) {
            const statusUpdate = {
              [statusColumn.id]: { index: 1 }
            };
            
            const statusResult = await updateMondayColumns(webhookItemId, webhookBoardId, statusUpdate);
            
            if (!statusResult.errors) {
              console.log('✅ Status updated to "Board and form generated"');
            } else {
              console.log('⚠️ Status update errors:', statusResult.errors);
              console.log('💡 Check status column index in Monday.com');
            }
          } else {
            console.log('⚠️ Status column not found');
          }
        } catch (statusError) {
          console.error('❌ Status update failed:', statusError.message);
        }
      }
    }
    
    return res.status(200).json({
      success: true,
      createdBoard: data
    });
    
  } catch (error) {
    console.error("❌ Error creating board:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// ==================== SHORTEN WITH QR ====================
app.post('/api/shorten-with-qr', async (req, res) => {

  console.log("\n🚀 Shorten-with-QR Webhook:");
  console.log(JSON.stringify(req.body, null, 2));

  if (req.body.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  try {
    const event = req.body.event;
    const itemId = event?.pulseId;
    const boardId = event?.boardId;

    if (!itemId || !boardId) {
      return res.status(400).json({ success: false });
    }

    res.status(200).json({ success: true });
    console.log("✅ Immediate response sent");

    const itemData = await getMondayItemData(itemId);
    const boardColumns = await getBoardColumns(boardId);

    let longUrl = null;

    for (const column of itemData.column_values) {
      if (column.type === 'link' && column.value) {
        const parsed = JSON.parse(column.value);
        longUrl = parsed.url;
        break;
      }
    }

    if (!longUrl) {
      console.log("⚠️ No URL found");
      return;
    }

    console.log("🔗 Long URL:", longUrl);

    const shortCode = generateShortCode();
    const shortUrl = `${req.protocol}://${req.get('host')}/s/${shortCode}`;

    console.log("✨ Short URL:", shortUrl);

    const qrBuffer = await QRCode.toBuffer(shortUrl, { width: 500 });

    const shortenedLinkColumn = boardColumns.find(col =>
      col.title.toLowerCase().includes('short')
    );

    const qrColumn = boardColumns.find(col =>
      col.title.toLowerCase().includes('qr')
    );

    const statusColumn = boardColumns.find(col =>
      col.title.toLowerCase() === 'status'
    );

    if (shortenedLinkColumn) {
      await updateMondayColumns(itemId, boardId, {
        [shortenedLinkColumn.id]: {
          url: shortUrl,
          text: shortUrl
        }
      });
    }

    if (qrColumn) {
      await uploadFileToMonday(
        itemId,
        qrColumn.id,
        qrBuffer,
        `qr-${shortCode}.png`
      );
    }

    if (statusColumn) {
      await updateMondayColumns(itemId, boardId, {
        [statusColumn.id]: { index: 1 }
      });
    }

    console.log("🎉 Processing Complete");

  } catch (error) {
    console.error("🔥 Error:", error);
  }
});


// ==================== REDIRECT ====================
app.get('/s/:shortCode', (req, res) => {
  const data = urlDatabase.get(req.params.shortCode);
  if (!data) return res.status(404).send("Not found");

  data.clicks++;
  res.redirect(data.originalUrl);
});


// ==================== START ====================
app.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
});