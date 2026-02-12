const express = require('express');
const fetch = require('node-fetch');
const app = express();


app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONDAY_API_KEY = process.env.MONDAY_API_KEY || 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjMzMzg0NDUzNiwiYWFpIjoxMSwidWlkIjo1NzI1NDM4OSwiaWFkIjoiMjAyNC0wMy0xNlQxOTo1MTo1My4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTQ5Mjc2NzgsInJnbiI6InVzZTEifQ.GzG-PARLDqJnQBQkff9Nj95pWdbc9CTRziyF4QdFNH4';

app.post('/webhook/monday', async (req, res) => {
  console.log('Body:', JSON.stringify(req.body, null, 2));

  // Monday verification challenge
  if (req.body.challenge) {
    return res.status(200).json({
      challenge: req.body.challenge
    });
  }

  try {
    // 🔹 Extract values from webhook
    const boardName = req.body.event?.boardName || "New Auto Board";
    const workspaceId = req.body.event?.workspaceId || '14192369';
    const folderId = req.body.event?.folderId || '19465689'; // <-- NEW

    if (!workspaceId || !folderId) {
      return res.status(400).json({
        success: false,
        message: "workspaceId and folderId are required"
      });
    }

    const query = `
      mutation ($boardName: String!, $workspaceId: Int!, $folderId: Int!) {
        create_board (
          board_name: $boardName,
          board_kind: public,
          workspace_id: $workspaceId,
          folder_id: $folderId
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
          folderId
        }
      })
    });

    const data = await response.json();

    console.log("Board created inside folder:", data);

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
