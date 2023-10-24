document.addEventListener("DOMContentLoaded", () => {
    const elements = document.querySelectorAll("body > [id]");
    elements.forEach(element => {
      const pageName = element.id;
      const pageUrl = `comp/${pageName}.html`;
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

    const navbarItems = document.querySelectorAll(".navbar li");

    navbarItems.forEach(item => {
        const childUl = item.querySelector("ul");

        item.addEventListener("mouseenter", () => {
            childUl.style.display = "block";
        });

        item.addEventListener("mouseleave", () => {
            childUl.style.display = "none";
        });
    });
});

