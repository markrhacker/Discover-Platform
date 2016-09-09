import * as app from "../src/app";
import * as nlqp from  "../src/NLQueryParser";
import * as bootstrap from "../src/bootstrap";
import * as dslparser from "../src/parser";
import {eve} from "../src/app";

// @HACK needed because browserify is being too clever by
// optimizing away unused code
var boostrapIxer = bootstrap.ixer;

app.renderRoots["nlqp"];

nlqp.debug = false;

function parseTest(queryString: string, n: number): nlqp.Intents {
  let parseResult: nlqp.Result;
  let avgTime = 0;
  let maxTime = 0;
  let minTime;

  // Parse string and measure how long it takes
  for (let i = 0; i < n; i++) {
    let start = performance.now();
    parseResult = nlqp.parse(queryString)[0];
    let stop = performance.now();
    avgTime += stop-start;
    if (stop-start > maxTime) {
      maxTime = stop-start;
    }  
    if (minTime === undefined) {
      minTime = stop-start;
    }
    else if (stop-start < minTime) {
      minTime = stop-start;
    }  
  }
  // Display result
  let tokenStrings = nlqp.tokenArrayToString(parseResult.tokens);
  let timingDisplay = `Timing (avg, max, min): ${(avgTime/n).toFixed(2)} | ${maxTime.toFixed(2)} | ${minTime.toFixed(2)} `;
  console.log(parseResult);
  console.log(queryString);
  console.log(`State: ${nlqp.Intents[parseResult.intent]}`);
  console.log(parseResult.context);
  console.log("-------------------------------------------------------------------------------------------");
  console.log("Tokens");  
  console.log(tokenStrings);
  console.log("-------------------------------------------------------------------------------------------");
  console.log("Tree");
  console.log(parseResult.tree.toString());
  console.log("-------------------------------------------------------------------------------------------");
  console.log("Query");  
  console.log("-------------------------------------------------------------------------------------------");
  console.log("Result");
  console.log(queryString);
  console.log(parseResult.query.toString());
  console.log(executeQuery(parseResult.query)[0]);
  console.log("-------------------------------------------------------------------------------------------");
  console.log(timingDisplay);
  console.log("===========================================================================================");
  return parseResult.intent;
}

function executeQuery(query: nlqp.Query): Array<string> {
  let resultsString: Array<string> = [];
  if (query.projects.length !== 0) {
    let queryString = query.toString();
    let artifacts = dslparser.parseDSL(queryString);
    let changeset = eve.diff();
    let results = [];
    for (let id in artifacts.views) {
      eve.asView(artifacts.views[id]); 
    }
    for (let id in artifacts.views) {
      results.push(artifacts.views[id].exec()); 
    }
    console.log(results);
    results.forEach((result) => {
      let projected = result.results;
      if (projected.length === 0) {
        return;
      }
      // Get each cell as a string
      let colWidths = [];
      let keys = Object.keys(projected[0]);
      keys.forEach((key) => {colWidths.push(key.length)});
      let rows: Array<Array<string>> = projected.map((row) => {
        let rowstring = keys.map((key,i) => {
          if (key === "__id") {
            return "";
          }
          let value = `${row[key]}`;
          let display = eve.findOne("display name",{id: value});
          if (display !== undefined) {
            value = display.name;
          }
          // Get the width of each row
          if (colWidths[i] < value.length) {
            colWidths[i] = value.length;
          }
          return value;
        });
        return rowstring;
      });
      // Turn rows into row strings
      let rowStrings = rows.map((row) => {
        row = row.map((cell,i) => {
          let whitespace = Array(colWidths[i] - cell.length + 1).join(" ");
          cell += whitespace;
          return cell;
        });
        return "| " + row.join(" | ");
      });
      // Add a table header
      let tableHeader = "| " + keys.map((key,i) => {
        if (key === "__id") {
          return "";
        }
        let whitespace = Array(colWidths[i] - key.length + 1).join(" ");
        return key.toUpperCase() + whitespace; 
      }).join(" | ");
      let divider = Array(tableHeader.length).join("-");
      let resultTable = divider += "\n" + tableHeader + "\n" + divider + "\n" + rowStrings.join("\n") + "\n" + divider; 
      resultsString.push(resultTable);
    });
  }
  return resultsString;
}

let n = 1;
let phrases = [ 
  // -------------------------------
  // These are queries that we had problems with in the past
  // make sure they always work
  // -------------------------------// 
  
  //"employees, salaries per department",
  /*
  "Corey's salary, department, and age",
  "Corey's wife's age, gender, and height",
  */
  
  // -------------------------------
  "moons year discovered after ariel year discovered",  
  "moons of jupiter",
  "moons discovered by sir william herschel",
  "jupiter's moons",
  "moons per planet",
  "planets per moon",
  "number of moons per planet",
  "count the number of moons per planet",
  "moons whose year discovered is 1610",
  "ganymede was discovered by",
  "planets with their moons", 
  "ganymede discovered by",
  "moons discovered by galileo galilei",
  "moons discovered by sir william herschel",
  "planets discovered by galileo galilei",
  "planets discovered by sir william herschel",
  "celestial bodies discovered by Galileo Galilei",  
  //"salary's sum * "
  //"composer compositions",
  //"composer composition",
  //"Corey's department is engineering",
  "corey's salary",
  //"josh's salary * corey montella's age"
  //"Chris' salary and department"
  //"Employee's union"
  "pets lengths",
  "employee departments",
  //"Corey's salary, department, and age",
  "3 - Corey's salary",
  "1+1",
  "employees with their departments",
  "employees with their departments and salaries",
  "employee salary and employee department",
  "employee salary and department",
  'test data that is an employee',
  "salaries per employee per department",
  "salaries per department per employee",
  `employees which are test data`,
  "sum of salaries in engineering",
  "sum of salaries in the engineering department",
  "salaries in engineering",
  'exotics that are test data',
  'test data that are employees',
  "Pets that not length",
  "pets that do not have a length",
  "Pets except those longer than a koala",
  "Pet not longer than koalas",
  "exotic that are not pets",
  "pets not exotics",
  "Pets that are exotic with length <= 3",
  "Pets that are exotic with length != 4",
  //"Corey's salary + 3",
  "exotic lengths",
  "sum lengths of pets that are exotic",
  "pets that are exotic that have length",
  "exotic pets",
  "sum of employee salaries",
  "salaries per department",
  "employee salaries",
  "sum employee salaries",
  "exotic lengths",
  "salaries by department",
  "employee salaries",
  "employees with their salaries",
  "employees with their departments",
  "employees and their salaries",
  "sum salaries",
  "Pet shorter than koala",
  "sum salaries per department",
  "sum salary per department",
  "pets lengths",
  "department salaries",
  "corey's salary",
  "lengths",
  "sum lengths",
  "sum pet lengths",
  "sum pet length",
    // -------------------------------
  //`Pets except those shorter than a koala`,
  //`salaries per department`,
  //`Employees not named Corey`,
  //`Pets koalas`,
  //`Employees who are not Corey`,
  //`Pets that are not longer than koalas`,
  //"exotic pets"
  //"Corey Montella's age, height, and gender",
  //"pets longer than dogs",
  //"department salaries",
  //"Pets shorter than dogs",
  //"Corey Montella's wife's age",
  //"salaries per department"
  //"Corey Montella's age height",
  //"Corey Montella's wife's age and height",
  //"Corey Montella's age, height",
  //"Steve's age and salary",
  //`age, height, and gender of "Corey Montella" and his nationality and age; and age and gender of "Rachel Romain Fay Montella" and her husband's wife's sister's height; and Corey's age`,
  //`"Corey Montella's" Wife's sister's age; and age and gender of "Rachel Romain Fay Montella" and her height; and Olivia Fay age, height, and gender; and pets shorter than snakes; and sum of salaries per department`,
  //"Corey Montella's age, height, and gender; and age and gender of Rachel Montella and her sister's age; and Olivia Fay age",
  //"What is Corey Montella's wife's age!",
  //"sum of the lengths of the pets",
  //"sum of the length of pets",
  //"Corey Montella's Height",
  //"People taller than Corey Montella",
  //"People younger than Corey Montella"
  //"sum of the lengths of the pets and the count of friends older than 30",
  //"sum of the lengths of the pets divided by their average age",
  //"Corey Montella's wife, Rachel Montella's husband's age, and Josh's pet turtle or Chris Steve Granger's pet dog",
  //"Corey James Montella's age or his wife's height",
  //"People younger than Corey Montella"
  /*
  "Corey Montella's age",
  "Corey Montella's hair color",
  "What was Corey Montella's lowest salary",
  "What was Corey's first car",
  /*
  "Corey Montella's age",
  "Corey's age",
  "People younger than Corey Montella",
  "Modern Family episode with Edward Norton",
  "Sum of the lengths of the pets",
  "Who loves Corey?",
  "Who does Corey love?",
  "Did the groundhog see its shadow?",
  "When did Corey go out with his wife or her friends?",
  "People younger than Corey Montella",
  "how often does chase have lunch with his wife or her friends",
  "people who are under 30 years old",
  "people who are under 30 pounds",
  "people who are under 30",
  "people whose age < Chris Granger's",
  "people whose age < Chris Granger's age",
  "people whose age is less than Chris Granger's",
  "people who are younger than Chris Granger",
  "people older than Corey Montella's spouse",
  "people older than their spouse",
  "people who are either heads or spouses of heads",
  "people who have red or black hair",
  "people who have a hair color of red or black",
  "people who have neither attended a meeting nor had a one-on-one",
  "salaries per department",
  "salaries per department and age",
  "salaries per department, employee, and age",
  "sum of the salaries per department",
  "average of the salaries per department",
  "top 2 employee salaries",
  "top 2 salaries per department",
  "sum of the top 2 salaries per department",
  "departments where all the employees are over-40 males",
  "employees whose sales are greater than their salary",
  "count employees and their spouses",
  "dishes with eggs and chicken",
  "dishes without eggs and chicken",
  "dishes without eggs or chicken",
  "dishes with eggs that aren't desserts",
  "dishes that take 30 minutes to an hour",
  "people who live alone",
  "everyone in this room speaks at least two languages",
  "Birds can fly, but penguins can not, but Harry the Rocket Penguin can.",
  "at least two languages are spoken by everyone in this room",
  "friends older than the average age of people with pets",
  "meetings john was in in the last 10 days",
  "parts that have a color of red, green, blue, or yellow",
  "employee salary / employee's department total cost",
  "Return the average number of publications by Bob in each year",
  "Return the conference in each area whose papers have the most total citations",
  "return all conferences in the database area",
  "return all the organizations, where the number of papers by the organization is more than the number of authors in IBM",
  "return the authors, where the number of papers by each author in VLDB is more than the number of papers in ICDE",
  "What are the populations of cities that are located in California?",
  "What jobs as a senior software developer are available in Houston but not San Antonio?",
  "Neither of these boys wants to try a piece of pineapple pizza.",
  "Shortest flight between New York and San Francisco",
  "When did Corey Montella marry his spouse?",
  "Ages of Chris Steve Granger, Corey James Irvine Montella, and Josh Cole",  
  "The sweet potatoes in the vegetable bin are green with mold.",
  "States in the United States of America",
  "People older than Chris Granger and younger than Edward Norton",
  "Sum of the salaries per department",
  "Dishes with eggs and chicken",
  "People whose age < 30",
  "People between 50 and 60 years old",
  "Steve is 10 years old and Sven is 12 years old",
  "salaries per department, employee, and age",
  "Where are the restaurants in San Francisco that serve good French food?",
  "Dishes that do not have eggs or chicken",
  "Who had the most sales last year?",
  "Which salesman had the highest total sales last year?",
  "departments where all of the employees are male",
  "sum of the top 2 salaries per department",
  "What is Corey Montella's age?",
  "People older than Corey Montella",
  "How many 4 star restaurants are in San Francisco?",
  "What is the average elevation of the highest points in each state?",
  "What is the name of the longest river in the state that has the largest city in the United States of America?",
  */
];

/*
let siriphrases = [
  "Find videos I took at Iva's birthday party",
  "Find pics from my trip to Aspen in 2014",
  "Find a table for four people tonight in Chicago",
  "Find a table for four tonight in Chicago",
  "How is the weather tomorrow?",
  "Wake me up at 7AM tomorrow",
  "Move my 2PM meeting to 2:30",
  "Do I have any new texts from Rick?",
  "Show my selfies from New Year's Eve",
  "Call Dad at work",
  "Aiesha Turner is my mom",
  "Read my latest email",
  "Text peet 'See you soon smiley exlamation point'",
  "What is trending on Twitter?",
  "Call back my last missed call.",
  "Where is Brian?",
  "Find tweets with the hashtag BayBridge",
  "Read my last message from Andrew",
  "Do I have any new voicemail?",
  "FaceTime Sarah",
  "Redial that last number",
  "Play the last voicemail from Aaron",
  "When did Ingrid call me?",
  "Get my call history",
  "Mark the third one complete",
  "Add Greg to my 2:30 meeting on Thursday",
  "Remind me about this email Friday at noon", // noon should be a quantity
  "Create a new list called Groceries", // why isn't a|DT includeded in "a new list"
  "Where is my next meeting?", // How can we make meeting a noun?
  "Set an alarm for 9 AM every Friday", // AM needs to be special cased to attach to 9
  "Cancel my meetings on Friday", // Cancel needs to be a verb
  "Turn off all my alarms",
  "Add brussels sprouts to my grocery list",
  "Remind me to pay Noah back tomorrow morning",
  // Sports
  "When is the next Mavericks home game?",
  "Who is the quarterback for Dallas?",
  "Who has the most RBIs",
  "Who won the NBA finals?",
  "Where is Wrigley Field?",
  "How many regular-season games does each NBA team play?",
  "When is the LA Galaxy's next home game?",
  "Who do the Chicago Cubs play on September 21?", // 21 needs to merge with September
  "When does the football season start?",
  "What hockey teams play today?",
  "Did the Chicago cubs win on Thursday?",
  // Entertainment
  "Play Third Eye Blind's new album",
  "Play more like this",
  "Play the number one song right now", // Needs help with noun grouping tag accuracy
  "What song is playing right now?", // right now is problematic
  "What movies are playing today?",
  "Where is Unbroken playing around here?", // playing around here is problematic
  "I like this song",
  "What are some PG movies playing this afternoon",
  "Who sings this?", // tags are all wrong, heuristics don't help it
  "I want to hear the live version of this song",
  "Play only songs by Nicki Minaj",
  "What won best picture in 2000?",
  "How are the ratings for The Boxtrolls?",
  "Who directed A Perfect World?",
  "Do people like The Theory of Everything?",
  // Out and about (aka Foursquare queries)
  "Where is a good Indian place around here?", // "place around here" is tagged wrong, heuristics don't help
  "I am running low on gas",
  "What time does Whole Foods close?",
  "Give me public transit direction to the De Young Museum", // Public is tagged a verb
  "Where is a good inexpensive place to eat around here?", // "To eat aroung here" is not recognized
  "Make a reservation at a romantic restaurant tonight at 7PM",
  "Find a happy hour nearby", // nearby should be an adverb?
  "Find coffee near me",
  "What planes are flying above me?", // Tags are all wrong: planes is a verb, flying is an adverb
  "I need some aspirin",
  "How are the reviews for Long Bridge Pizza in San Francisco?",
  "Where is a good hair salon?",
  "What's the best retaurant in San Francisco?",
  "I need a good electrician",
  "Where am I?",
  "What is my ETA?",
  // Homekit
  "Turn the lights blue",
  "Turn off the radio", // "off" should be a particle
  "Turn off the printer in the office", // "off" should be a particle
  "Lock the front door", // front is classified a noun, should be an adhective
  "Set the brightness of the downstairs lights to 50%",
  "Set the Tahoe house to 72 degrees", // house is a verb
  "Turn off Chloe's light", // "off" should be a particle 
  "Turn the living room lights all the way up", // lights is a verb
  "Turn on the bathroom heater",
  // Getting answers
  "Do I need an umbrella today?",
  "How is the Nikkei doing?",
  "When is daylight saving time?",
  "What is the definition of pragmatic?", // "pragmatic is an adjective"
  "What's the latest in San Francisco?",
  "Did the groundhog see its shadow?",
  "When is sunset in Paris", // sunset should be a noun
  "What is the population of Jamaica?",
  "What is the square root of 128?",
  "What is 40 degrees Farenheit in Celsius", // Here is an example where the proper noun combining heuristic fails
  "What is the temperature outside?", // outside is a preposition
  "What time is it in Berlin",
  "When was Abraham Lincoln born?", // This will get Abraham Lincoln, but we need to use "when" and "born" to figure out a date is expected
  "Show me the Orion constellation",
  "What's the high for Anchorage on Thursday?", // This breaks noun combining heuristic 
  "How many dollars is 45 Euros",
  "What day is it?",
  "How many calories in a bagel?",
  "What is Apple's P/E ratio?",
  "Compare AAPL and NASDAQ",
  "How humid is it in New York right now", // Heuristics mess up tagging, "is" is a noun in order to use "humid" as an adjective
  "What's an 18% tip on $85?",
  "What is the UV index outside?",
  "How many cups in a liter",
  "Is it going to snow next week?",
];
*/

app.init("nlqp", function () {
  console.log(`Running ${phrases.length} tests...`);
  console.log("===========================================================================================");
  let queryStates = phrases.map((phrase) => {return parseTest(phrase,n)});
  let query = queryStates.filter((state) => state === nlqp.Intents.QUERY).length;
  let insert = queryStates.filter((state) => state === nlqp.Intents.INSERT).length;
  let moreinfo = queryStates.filter((state) => state === nlqp.Intents.MOREINFO).length;
  let noresult = queryStates.filter((state) => state === nlqp.Intents.NORESULT).length;
  console.log("===========================================================================================");
  console.log(`Total Queries: ${phrases.length} | Query: ${query} | Insert: ${insert} | MoreInfo: ${moreinfo} | NoResult: ${noresult}`);
  console.log("===========================================================================================");
});