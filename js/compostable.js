document.addEventListener("DOMContentLoaded", () => {
    const elements = document.querySelectorAll("body > [id]");
    elements.forEach(element => {
      const pageName = element.id;
      const pageUrl = `${pageName}.html`;
      fetch(pageUrl)
        .then(response => {
          if (response.ok) {
            return response.text();
          } else {
            throw new Error("File not found");
          }
        })
        .then(data => {
          element.innerHTML = data;
        })
        .catch(error => console.log(error));
    });
  });