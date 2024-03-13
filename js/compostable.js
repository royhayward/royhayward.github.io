function getRandomCard(e) {
  fetch("cards/")
    .then((response) => response.text())
    .then((data) => {
      const files = data.split("\\n");
      const randomIndex = Math.floor(Math.random() * files.length);
      const randomFile = files[randomIndex].trim();
      console.log(randomFile);
      fetch(`cards/${randomFile}`)
        .then((response) => response.text())
        .then((cardData) => {
          e.innerHTML = cardData;
        })
        .catch((error) => console.log(error));
    })
    .catch((error) => console.log(error));
}
function getPageName() {
  const url = window.location.href;
  const lastSlashIndex = url.lastIndexOf("/");
  const pageWithExtension = url.substring(lastSlashIndex + 1);
  const pageName = pageWithExtension.split(".")[0];
  return pageName;
}

function loadPageParts() {
  const elements = document.querySelectorAll("body > [id]");
  elements.forEach((element) => {
    var pageName = element.id;
    if (pageName == "index") {
      var dir = "pages";
      var pageName = "index";
    } else if (pageName == "article") {
      var dir = "pages";
      var pageName = getPageName();
    } else {
      var dir = "comp";
    }
    const pageUrl = `${dir}/${pageName}.html`;
    fetch(pageUrl)
      .then((response) => {
        if (response.ok) {
          return response.text();
        } else {
          console.log(pageUrl);
          throw new Error("File not found");
        }
      })
      .then((data) => {
        element.innerHTML = data;
      })
      .catch((error) => console.log(error));
  });
}
document.addEventListener("DOMContentLoaded", () => {
  loadPageParts();
  const navbarItems = document.querySelectorAll(".navbar li");

  const pickACardElements = document.querySelectorAll("#pick-a-card");
  pickACardElements.forEach((element) => {
    getRandomCard(element);
  });
});
