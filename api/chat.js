export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  try {

    const { message } = req.body;


    console.log("User message:", message);

    console.log(
      "API KEY EXISTS:",
      !!process.env.GEMINI_API_KEY
    );


    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({

          contents: [
            {
              parts: [
                {
                  text: message
                }
              ]
            }
          ]

        })

      }
    );


    const data = await response.json();


    console.log(
      "Gemini Status:",
      response.status
    );


    console.log(
      "Gemini Data:",
      JSON.stringify(data)
    );


    if (!response.ok) {

      return res.status(response.status).json({

        error:
          data.error?.message ||
          "Gemini API failed"

      });

    }


    if (
      !data.candidates ||
      data.candidates.length === 0
    ) {

      return res.status(500).json({

        error:
        "Gemini returned no response"

      });

    }


    const reply =
      data.candidates[0]
      .content
      .parts[0]
      .text;


    return res.status(200).json({

      reply

    });


  } catch(error) {


    console.log(
      "SERVER ERROR:",
      error
    );


    return res.status(500).json({

      error:error.message

    });

  }

}