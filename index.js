/* global require, module */
var TapReporter = require('./node_modules/ember-cli/node_modules/testem/lib/reporters/tap_reporter');
var Table = require('cli-table');
var colors = require('colors/safe');

String.prototype.splice = function(index, count, add) {
  return this.slice(0, index) + (add || '') + this.slice(index + count);
};

// black on yellow for skipped
var COLOR_SKIP = colors.black.bgYellow;

// white on red for failed
var COLOR_FAIL = colors.white.bgRed;

function generateTable(reporter) {
  var TOTAL_INDEX = 0;
  var PASSED_INDEX = 1;
  var FAILED_INDEX = 2;
  var SKIPPED_INDEX = 3;
  var TOTAL_TIME_INDEX = 4;
  var MEAN_TIME_INDEX = 5;
  var MEDIAN_TIME_INDEX = 6;
  var MODE_TIME_INDEX = 7;

  var TOTAL_HEADER = 'total tests';
  var PASSED_HEADER = 'passed tests';
  var FAILED_HEADER = 'failed tests';
  var SKIPPED_HEADER = 'skipped tests';
  var TOTAL_TIME_HEADER = 'total time (ms)';
  var MEAN_TIME_HEADER = 'mean time (ms)';
  var MEDIAN_TIME_HEADER = 'median time (ms)';
  var MODE_TIME_HEADER = 'mode time (ms)';

  function testsByType(type) {
    type = type.toLowerCase();
    return function(test) {
      return test.name.substring(0, type.length).toLowerCase() === type;
    };
  }

  var tests = reporter.results.map(function(data) { return data.result; });
  var acceptanceTests = tests.filter(testsByType('acceptance'));
  var integrationTests = tests.filter(testsByType('integration'));
  var unitTests = tests.filter(testsByType('unit'));
  var lintingTests = tests.filter(testsByType('eslint'));

  function genProcessStatsFn() {
    var medianHelper;

    function insert(array, element) {
      function findInsertIndex(array, element) {
        var start = 0;
        var end = array.length;
        var pivot = parseInt(start + (end - start) / 2, 10);
        while (end - start > 1 && array[pivot] !== element) {
          if (array[pivot] < element) {
            start = pivot;
          } else {
            end = pivot;
          }
          pivot = parseInt(start + (end - start) / 2, 10);
        }
        return pivot + 1;
      }

      var index = findInsertIndex(array, element);
      array.splice(index, 0, element);
      return array;
    }

    return function processStats(results, test) {
      if (results[TOTAL_INDEX] === 0) {
        medianHelper = [];
      }

      insert(medianHelper, test.runDuration);
      var medianLength = medianHelper.length - 1;

      results[PASSED_INDEX] += test.passed ? 1 : 0;
      results[FAILED_INDEX] += !(test.passed || test.skipped) ? 1 : 0;
      results[SKIPPED_INDEX] += test.skipped ? 1 : 0;
      results[TOTAL_TIME_INDEX] += test.runDuration;
      results[MEAN_TIME_INDEX] = results[TOTAL_TIME_INDEX] / ++results[TOTAL_INDEX];
      results[MEDIAN_TIME_INDEX] = (medianHelper[Math.floor(medianLength / 2)] + medianHelper[Math.ceil(medianLength / 2)]) / 2;
      results[MODE_TIME_INDEX] = Math.max(results[MODE_TIME_INDEX], test.runDuration);
      return results;
    };
  }

  function genProcessedBase() {
    var base = [];
    base[TOTAL_INDEX] = 0;
    base[PASSED_INDEX] = 0;
    base[FAILED_INDEX] = 0;
    base[SKIPPED_INDEX] = 0;
    base[TOTAL_TIME_INDEX] = 0;
    base[MEAN_TIME_INDEX] = 0;
    base[MEDIAN_TIME_INDEX] = 0;
    base[MODE_TIME_INDEX] = 0;
    return base;
  }

  var processedTests = {
    'all': tests.reduce(genProcessStatsFn(), genProcessedBase()),
    'acceptance': acceptanceTests.reduce(genProcessStatsFn(), genProcessedBase()),
    'integration': integrationTests.reduce(genProcessStatsFn(), genProcessedBase()),
    'unit': unitTests.reduce(genProcessStatsFn(), genProcessedBase()),
    'eslint': lintingTests.reduce(genProcessStatsFn(), genProcessedBase()),
  };

  var headers = [];
  headers[TOTAL_INDEX] = TOTAL_HEADER;
  headers[PASSED_INDEX] = PASSED_HEADER;
  headers[FAILED_INDEX] = FAILED_HEADER;
  headers[SKIPPED_INDEX] = SKIPPED_HEADER;
  headers[TOTAL_TIME_INDEX] = TOTAL_TIME_HEADER;
  headers[MEAN_TIME_INDEX] = MEAN_TIME_HEADER;
  headers[MEDIAN_TIME_INDEX] = MEDIAN_TIME_HEADER;
  headers[MODE_TIME_INDEX] = MODE_TIME_HEADER;
  headers.unshift('');

  var headerColors = [ (reporter.total - reporter.pass - (reporter.skipped || 0) === 0) ? 'green' : 'red' ];

  var table = new Table({ head: headers, style: { head: headerColors } });
  table.push.apply(table, Object.keys(processedTests).map(function(key) {
    var obj = {};
    obj[key] =  processedTests[key];
    return obj;
  }));

  return table.toString();
}

function StatisticsReporter() {
  TapReporter.apply(this, arguments);
}
StatisticsReporter.prototype = new TapReporter();
StatisticsReporter.prototype.constructor = StatisticsReporter;
StatisticsReporter.prototype.display = function(prefix, result) {
  // remember id
  result.id = this.id;

  // stub this.out.write
  var out = this.out;
  var output;
  this.out = {
    write: function(input) {
      output = input;
    }
  };

  // call method on parent class
  TapReporter.prototype.display.apply(this, arguments);

  // add test duration to output
  output = output.splice(output.indexOf(' -'), 0, ' - [' + result.runDuration + ' ms]');

  // set color
  if (!result.passed) {
    var colorize = result.skipped ? COLOR_SKIP : COLOR_FAIL;
    output = output.splice(0, output.indexOf('\n'), colorize(output.substring(0, output.indexOf('\n'))));
  }

  // reset this.out
  this.out = out;

  this.out.write(output);
};
StatisticsReporter.prototype.summaryDisplay = function() {
  // stub this.out.write
  var out = this.out;
  var failedTests = '';
  this.out = {
    write: function(input) {
      failedTests += (!failedTests ? '\nReprinting failed tests...\n' : '') + input;
    }
  };

  this.results.filter(function(data) { return !data.result.passed && !data.result.skipped; })
              .forEach(function(data) {
                // recall id
                this.id = data.result.id;

                // append test result display to reiteration of failed tests
                this.display(data.launcher, data.result);
              }.bind(this));

  // reset this.out
  this.out = out;

  return [
    generateTable(this),
    failedTests,
    TapReporter.prototype.summaryDisplay.call(this),
  ].join('\n');
};

module.exports = StatisticsReporter;
