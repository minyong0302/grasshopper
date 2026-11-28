const yearFilter = document.querySelector(".year-filter");
const yearSelect = document.querySelector("#activity-year");
const emptyMessage = document.querySelector(".activity-empty");
const records = Array.from(document.querySelectorAll(".activity-post"), (element) => ({
  element,
  year: element.querySelector("time[datetime]")?.dateTime.match(/^(\d{4})-\d{2}-\d{2}$/)?.[1],
}));
const years = [...new Set(records.map(({ year }) => year).filter(Boolean))]
  .sort((left, right) => Number(right) - Number(left));

function showSelectedYear() {
  for (const { element, year } of records) {
    element.hidden = year !== yearSelect.value;
  }
}

if (years.length) {
  for (const year of years) yearSelect.add(new Option(`${year}년`, year));
  yearSelect.addEventListener("change", showSelectedYear);
  showSelectedYear();
  yearFilter.hidden = false;
} else {
  emptyMessage.hidden = records.length > 0;
}
